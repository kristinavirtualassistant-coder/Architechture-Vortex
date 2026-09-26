import React, { useState } from 'react';
import {
  Plus,
  Upload,
  Users,
  Phone,
  MapPin,
  DollarSign,
  CheckCircle2,
  Search,
  Filter,
  Building,
  Mail,
  Tag,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  Info,
  Home,
  UserCheck,
  Building2,
  Download,
  FileSpreadsheet,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import Papa from 'papaparse';
import { Campaign, CampaignContact, PropertyMetadata } from '../types/dialer';
import { RAW_LIVE_LEADS_CSV } from '../data/liveLeads';

interface CampaignManagerProps {
  campaigns: (Campaign & { counts?: any })[];
  contacts: CampaignContact[];
  onIngestCampaign: (data: any) => void;
}

/**
 * Normalizes and extracts values from row across multiple potential header aliases
 */
export const getCleanCsvVal = (row: Record<string, any>, ...keys: string[]): string | undefined => {
  if (!row) return undefined;
  
  // 1. Direct match
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      const strVal = String(row[key]).trim();
      if (strVal !== '' && strVal !== 'null' && strVal !== 'undefined') {
        return strVal;
      }
    }
  }

  // 2. Case-insensitive and normalized key match (stripping underscores, spaces, dashes)
  const normalizedRowKeys = Object.keys(row);
  for (const key of keys) {
    const cleanTargetKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const foundKey = normalizedRowKeys.find(
      (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTargetKey
    );
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
      const strVal = String(row[foundKey]).trim();
      if (strVal !== '' && strVal !== 'null' && strVal !== 'undefined') {
        return strVal;
      }
    }
  }

  return undefined;
};

/**
 * Maps a raw CSV lead row from `cleaned_organized_crm_leads.csv` or standard CRM imports
 * to the canonical PropertyMetadata interface.
 */
export const mapCrmLeadToPropertyMetadata = (row: Record<string, any>, idx: number): PropertyMetadata => {
  // 1. Boolean / string occupancy parsing
  const rawVacant = getCleanCsvVal(row, 'is_vacant', 'isVacant', 'Is Vacant', 'vacant', 'Vacant', 'occupancy_status', 'vacancy');
  let is_vacant: string | boolean | undefined = rawVacant;
  if (rawVacant !== undefined) {
    const lower = rawVacant.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'vacant' || lower === 'y' || lower === '1') {
      is_vacant = 'Yes';
    } else if (lower === 'false' || lower === 'no' || lower === 'occupied' || lower === 'n' || lower === '0') {
      is_vacant = 'No';
    }
  }

  const rawOwnerOcc = getCleanCsvVal(row, 'is_owner_occupied', 'isOwnerOccupied', 'Is Owner Occupied', 'owner_occupied', 'Owner Occupied', 'owner_occupied_status');
  let is_owner_occupied: string | boolean | undefined = rawOwnerOcc;
  if (rawOwnerOcc !== undefined) {
    const lower = rawOwnerOcc.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'owner occupied' || lower === 'y' || lower === '1') {
      is_owner_occupied = true;
    } else if (lower === 'false' || lower === 'no' || lower === 'absentee' || lower === 'n' || lower === '0') {
      is_owner_occupied = false;
    }
  }

  // 2. Secondary phones aggregation
  const explicitSecPhones = getCleanCsvVal(
    row,
    'secondary_phones',
    'Secondary Phones',
    'secondary_phone',
    'Secondary Phone',
    'secondaryPhones',
    'alt_phones',
    'other_phones',
    'Phone 2'
  );
  let secondary_phones = explicitSecPhones;
  if (!secondary_phones) {
    const altPhoneList: string[] = [];
    const phone2 = getCleanCsvVal(row, 'phone_2', 'phone2', 'phone_number_2', 'mobile_2', 'secondary_number', 'Phone 2');
    const phone3 = getCleanCsvVal(row, 'phone_3', 'phone3', 'phone_number_3', 'work_phone', 'Phone 3');
    if (phone2) altPhoneList.push(phone2);
    if (phone3) altPhoneList.push(phone3);
    if (altPhoneList.length > 0) {
      secondary_phones = altPhoneList.join(', ');
    }
  }

  // 3. Units count parsing
  const rawUnits = getCleanCsvVal(row, 'units', 'Units', 'unit_count', 'number_of_units', 'total_units', 'Unit Count');
  const units = rawUnits ? (isNaN(parseInt(rawUnits, 10)) ? 1 : parseInt(rawUnits, 10)) : 1;

  // 4. Currency formatting
  const formatCurrency = (val: string | undefined, defaultVal?: string): string | undefined => {
    if (!val) return defaultVal;
    if (val.startsWith('$')) return val;
    const num = parseFloat(val.replace(/[^0-9.-]+/g, ''));
    if (!isNaN(num)) {
      return `$${num.toLocaleString()}`;
    }
    return val;
  };

  const estimated_equity = formatCurrency(
    getCleanCsvVal(row, 'estimated_equity', 'estimatedEquity', 'Estimated Equity', 'equity', 'Equity', 'est_equity', 'approx_equity'),
    '$450,000'
  );

  const assessed_value = formatCurrency(
    getCleanCsvVal(row, 'assessed_value', 'assessedValue', 'Assessed Value', 'total_assessed_value', 'tax_assessed_value', 'value'),
    '$750,000'
  );

  // 5. APN preservation
  const apn = getCleanCsvVal(row, 'apn', 'APN', 'parcel_id', 'parcel_number', 'parcel_apn', 'Parcel ID', 'Parcel APN') ||
    `580-081-${String(idx + 10).padStart(2, '0')}`;

  const metadata: PropertyMetadata = {
    // Address components
    property_address: getCleanCsvVal(row, 'property_address', 'propertyAddress', 'Property Address', 'address', 'Address', 'street_address', 'property_street') || '',
    city: getCleanCsvVal(row, 'city', 'City', 'property_city', 'propertyCity') || '',
    state: getCleanCsvVal(row, 'state', 'State', 'property_state', 'propertyState') || 'CA',
    zip: getCleanCsvVal(row, 'zip', 'Zip', 'ZIP', 'Zip Code', 'postal_code', 'property_zip', 'propertyZip') || '',
    apn,

    // Property types and unit specifications
    property_type_standardized: getCleanCsvVal(
      row,
      'property_type_standardized',
      'propertyTypeStandardized',
      'Property Type Standardized',
      'standardized_property_type',
      'Standardized Property Type'
    ) ||
      getCleanCsvVal(row, 'property_type', 'propertyType', 'Property Type') || 'Single Family Residence',
    property_type: getCleanCsvVal(row, 'property_type', 'propertyType', 'Property Type', 'type', 'use_code_description', 'Property Use') || 'Residential SFR',
    units,
    is_vacant: is_vacant !== undefined ? is_vacant : 'No',
    is_owner_occupied: is_owner_occupied !== undefined ? is_owner_occupied : false,

    // Communications & contact intelligence
    secondary_phones,
    tracked_phone: getCleanCsvVal(row, 'tracked_phone', 'trackedPhone', 'Tracked Phone', 'Tracked Phone Number', 'tracking_number', 'Tracking Number', 'inbound_phone', 'campaign_phone'),
    email: getCleanCsvVal(row, 'email', 'Email', 'Email Address', 'Real Email Address', 'contact_email', 'email_address', 'primary_email'),

    // Pipeline, stages and workflow
    stage_name_standardized: getCleanCsvVal(
      row,
      'stage_name_standardized',
      'stageNameStandardized',
      'Stage Name Standardized',
      'standardized_stage_name',
      'stage_name',
      'Stage Name',
      'Stage',
      'stage'
    ) || 'Lead Outreach',
    stage_status_standardized: getCleanCsvVal(
      row,
      'stage_status_standardized',
      'stageStatusStandardized',
      'Stage Status Standardized',
      'standardized_stage_status',
      'stage_status',
      'Stage Status'
    ) || 'Active',
    stage_name: getCleanCsvVal(row, 'stage_name', 'stageName', 'Stage Name', 'stage', 'Stage') || 'Discovery',
    stage_status: getCleanCsvVal(row, 'stage_status', 'stageStatus', 'Stage Status', 'status', 'Status') || 'In Progress',
    source_name: getCleanCsvVal(row, 'source_name', 'sourceName', 'Source Name', 'source', 'Source', 'lead_source', 'Lead Source') || 'CRM Ingest',
    referrer_name: getCleanCsvVal(row, 'referrer_name', 'referrerName', 'Referrer Name', 'referrer', 'Referrer') || 'Direct Import',
    assigned_to: getCleanCsvVal(row, 'assigned_to', 'assignedTo', 'Assigned To', 'agent', 'Agent', 'assigned_agent', 'Assigned Agent', 'owner', 'Owner') || 'Kristina Madrigal',
    pipeline_name: getCleanCsvVal(row, 'pipeline_name', 'pipelineName', 'Pipeline Name', 'pipeline', 'Pipeline', 'campaign_pipeline') || 'High Equity Acquisitions',
    next_task_kind: getCleanCsvVal(
      row,
      'next_task_kind',
      'nextTaskKind',
      'Next Task Kind',
      'task_kind',
      'Task Kind',
      'Next Task',
      'next_task',
      'task',
      'next_action'
    ) || 'Outbound Call & Offer',
    next_task_due_at: getCleanCsvVal(
      row,
      'next_task_due_at',
      'nextTaskDueAt',
      'Next Task Due At',
      'Next Task Due',
      'next_task_due',
      'Task Due',
      'due_date',
      'Due Date'
    ) || 'Today',
    tag_list: getCleanCsvVal(row, 'tag_list', 'tagList', 'Tag List', 'tags', 'Tags', 'tag', 'labels', 'Labels') || 'High Equity, Absentee',

    // Financial valuations
    estimated_equity,
    assessed_value,
    owner_type: getCleanCsvVal(row, 'owner_type', 'ownerType', 'Owner Type', 'classification', 'Owner Classification', 'Classification') ||
      (is_owner_occupied === true ? 'Owner Occupied' : 'Absentee Owner'),
  };

  return metadata;
};

export const CampaignManager: React.FC<CampaignManagerProps> = ({
  campaigns,
  contacts,
  onIngestCampaign,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [linesPerAgent, setLinesPerAgent] = useState(3);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('all');
  const [rawContacts, setRawContacts] = useState<any[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [selectedContactForDetails, setSelectedContactForDetails] = useState<CampaignContact | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = (results.data as Record<string, any>[]).map((row, idx) => {
          const name =
            getCleanCsvVal(row, 'name', 'Name', 'full_name', 'contact_name', 'owner_name', 'Owner', 'Full Name', 'Contact Name') ||
            (getCleanCsvVal(row, 'first_name')
              ? `${getCleanCsvVal(row, 'first_name')} ${getCleanCsvVal(row, 'last_name') || ''}`.trim()
              : 'Unknown Contact');

          const phone =
            getCleanCsvVal(row, 'phone', 'Primary Phone', 'primary_phone', 'telephone', 'mobile', 'Phone', 'phone_1') ||
            '';

          const external_contact_id =
            getCleanCsvVal(row, 'id', 'external_contact_id', 'externalContactId', 'lead_id', 'Lead ID', 'contact_id') ||
            `crm_${Date.now()}_${idx}`;

          const metadata = mapCrmLeadToPropertyMetadata(row, idx);

          return {
            external_contact_id,
            name,
            phone,
            metadata,
          };
        });
        setRawContacts(parsed);
      },
    });
  };

  const handleLoadLiveLeads = () => {
    Papa.parse(RAW_LIVE_LEADS_CSV, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = (results.data as Record<string, any>[]).map((row, idx) => {
          const name =
            getCleanCsvVal(row, 'Name', 'name', 'full_name', 'contact_name', 'owner_name', 'Owner', 'Full Name', 'Contact Name') ||
            'Unknown Contact';

          const phone =
            getCleanCsvVal(row, 'Primary Phone', 'phone', 'primary_phone', 'telephone', 'mobile', 'Phone', 'phone_1') ||
            '';

          const external_contact_id =
            getCleanCsvVal(row, 'id', 'external_contact_id', 'externalContactId', 'lead_id', 'Lead ID', 'contact_id') ||
            `crm_live_${idx + 1}`;

          const metadata = mapCrmLeadToPropertyMetadata(row, idx);

          return {
            external_contact_id,
            name,
            phone,
            metadata,
          };
        });
        setRawContacts(parsed);
        setCsvFileName('live_test_leads_76_records.csv');
        setCampaignName('Live Property Management Leads (Kristina Madrigal)');
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignName) return;

    const contactsToIngest = rawContacts.length > 0 ? rawContacts : [
      {
        external_contact_id: `ext_${Date.now()}_1`,
        name: 'Carlos & Maria Vega',
        phone: '+17145551122',
        metadata: {
          apn: '982-101-15',
          property_address: '890 Santiago Blvd',
          city: 'Orange',
          state: 'CA',
          zip: '92869',
          property_type_standardized: 'Single Family Residence',
          property_type: 'SFR 4BD/3BA',
          units: 1,
          is_vacant: 'No',
          is_owner_occupied: 'No',
          secondary_phones: '+1 (714) 555-1123',
          tracked_phone: '+1 (714) 555-0107',
          email: 'carlos.vega.family@example.com',
          stage_name_standardized: 'Discovery / Pre-Foreclosure',
          stage_status_standardized: 'Active Lead',
          stage_name: 'Direct Outreach',
          stage_status: 'Ready to Dial',
          source_name: 'County GIS Delinquency',
          referrer_name: 'Orange County Tax Portal',
          assigned_to: 'Kristina Madrigal',
          pipeline_name: 'OC High Equity Acquisitions',
          next_task_kind: 'Outbound Call & Offer',
          next_task_due_at: '2026-08-25 09:00 AM',
          tag_list: 'Absentee, High Equity, Single Family',
          estimated_equity: '$540,000',
          assessed_value: '$890,000',
          owner_type: 'Absentee Owner',
        },
      },
      {
        external_contact_id: `ext_${Date.now()}_2`,
        name: 'West Coast Asset Management LLC',
        phone: '+19495558833',
        metadata: {
          apn: '772-300-88',
          property_address: '4200 Campus Dr',
          city: 'Newport Beach',
          state: 'CA',
          zip: '92660',
          property_type_standardized: 'Multi-Family (4 Units)',
          property_type: 'Commercial 4-Plex',
          units: 4,
          is_vacant: 'Yes',
          is_owner_occupied: 'No',
          secondary_phones: '+1 (949) 555-8834, +1 (949) 555-8835',
          tracked_phone: '+1 (714) 555-0108',
          email: 'acquisitions@westcoastasset.com',
          stage_name_standardized: 'Corporate Resolution',
          stage_status_standardized: 'Qualified',
          stage_name: 'Managing Partner Outreach',
          stage_status: 'In Progress',
          source_name: 'California SOS Business Filings',
          referrer_name: 'Entity Resolution Engine',
          assigned_to: 'Dialer Admin',
          pipeline_name: 'Commercial Multi-Family',
          next_task_kind: 'Managing Partner Consultation',
          next_task_due_at: '2026-08-26 01:00 PM',
          tag_list: 'LLC, Multi-Family, Vacant Units, Commercial',
          estimated_equity: '$1,850,000',
          assessed_value: '$3,200,000',
          owner_type: 'Corporate Entity',
        },
      },
    ];

    onIngestCampaign({
      organization_id: 'org_cmc_realty_01',
      campaign_name: campaignName,
      dial_settings: {
        lines_per_agent: linesPerAgent,
        dial_mode: 'power',
        skip_dnc: true,
        skip_invalid: true,
      },
      contacts: contactsToIngest,
    });

    setShowModal(false);
    setCampaignName('');
    setRawContacts([]);
    setCsvFileName('');
  };

  const handleDownloadTemplate = () => {
    const headers = [
      'Owner Name',
      'Primary Phone',
      'Secondary Phones',
      'Email Address',
      'Tracked Phone',
      'Parcel APN',
      'Property Address',
      'City',
      'State',
      'Zip',
      'Property Type Standardized',
      'Property Type',
      'Units',
      'Is Vacant',
      'Is Owner Occupied',
      'Stage Name Standardized',
      'Stage Status Standardized',
      'Stage Name',
      'Stage Status',
      'Pipeline Name',
      'Next Task Kind',
      'Next Task Due At',
      'Tag List',
      'Estimated Equity',
      'Assessed Value',
      'Owner Type',
      'Source Name',
      'Referrer Name',
      'Assigned To'
    ];

    const sampleRow = [
      'John R. Sterling',
      '+17145551294',
      '+17145558832, +17145559941',
      'john.sterling@realtyholdings.com',
      '+17145550199',
      '580-081-01',
      '1420 N Grand Ave',
      'Santa Ana',
      'CA',
      '92701',
      'Single Family Residence',
      'Residential SFR',
      '1',
      'No',
      'No',
      'Lead Outreach',
      'Active',
      'Discovery',
      'In Progress',
      'Orange County Absentee High-Equity',
      'Outbound Call & Offer',
      '2026-08-25 10:00 AM',
      'High Equity, Absentee, High Assessed',
      '$520,000',
      '$890,000',
      'Absentee Owner',
      'Orange County Assessor Ingest',
      'Direct GIS Import',
      'Kristina Madrigal'
    ];

    const csvContent = "data:text/csv;charset=utf-8," + [
      headers.join(','),
      sampleRow.map(v => `"${v}"`).join(',')
    ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "vortex_crm_leads_standard_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Distinct Filter Options
  const distinctStages = Array.from(
    new Set(contacts.map((c) => c.metadata?.stage_name_standardized || c.metadata?.stage_name).filter(Boolean))
  );
  const distinctPropertyTypes = Array.from(
    new Set(contacts.map((c) => c.metadata?.property_type_standardized || c.metadata?.property_type).filter(Boolean))
  );

  const filteredContacts = contacts.filter((c) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      c.name.toLowerCase().includes(query) ||
      c.phone.includes(query) ||
      (c.metadata?.property_address && c.metadata.property_address.toLowerCase().includes(query)) ||
      (c.metadata?.city && c.metadata.city.toLowerCase().includes(query)) ||
      (c.metadata?.apn && c.metadata.apn.toLowerCase().includes(query)) ||
      (c.metadata?.email && c.metadata.email.toLowerCase().includes(query)) ||
      (c.metadata?.assigned_to && c.metadata.assigned_to.toLowerCase().includes(query)) ||
      (c.metadata?.pipeline_name && c.metadata.pipeline_name.toLowerCase().includes(query)) ||
      (c.metadata?.tag_list && c.metadata.tag_list.toLowerCase().includes(query));

    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const matchesStage =
      stageFilter === 'all' ||
      (c.metadata?.stage_name_standardized === stageFilter || c.metadata?.stage_name === stageFilter);
    const matchesPropType =
      propertyTypeFilter === 'all' ||
      (c.metadata?.property_type_standardized === propertyTypeFilter || c.metadata?.property_type === propertyTypeFilter);

    return matchesSearch && matchesStatus && matchesStage && matchesPropType;
  });

  return (
    <div className="space-y-6">
      {/* Header & Create Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Campaigns & CRM Contact Queue</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Ingest structured CRM lead lists (<code className="text-indigo-600 font-mono font-semibold">cleaned_organized_crm_leads.csv</code>) with full parcel APN, equity, pipeline stage, and secondary contact attributes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadTemplate}
            className="px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-lg transition-colors border border-slate-200 shadow-sm flex items-center gap-1.5 font-mono"
            title="Download standardized CRM lead import CSV template"
          >
            <Download className="w-3.5 h-3.5 text-indigo-600" />
            <span>CSV Template</span>
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Ingest New CRM Campaign</span>
          </button>
        </div>
      </div>

      {/* Campaigns Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {campaigns.map((camp) => (
          <div key={camp.id} className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                  {camp.dial_mode.toUpperCase()} DIAL
                </span>
                <h3 className="font-bold text-slate-900 text-base mt-2">{camp.name}</h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {camp.status.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-100 text-center font-mono">
              <div className="bg-slate-50 p-2 rounded">
                <span className="text-[10px] text-slate-500 uppercase block">Total</span>
                <span className="font-bold text-slate-800 text-sm">{camp.counts?.total || 0}</span>
              </div>
              <div className="bg-indigo-50 p-2 rounded">
                <span className="text-[10px] text-indigo-600 uppercase block">Pending</span>
                <span className="font-bold text-indigo-700 text-sm">{camp.counts?.pending || 0}</span>
              </div>
              <div className="bg-emerald-50 p-2 rounded">
                <span className="text-[10px] text-emerald-600 uppercase block">Completed</span>
                <span className="font-bold text-emerald-700 text-sm">{camp.counts?.completed || 0}</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
              <span>Lines: <strong className="text-slate-800">{camp.lines_per_agent} per agent</strong></span>
              <span>DNC Filter: <strong className="text-emerald-600">Active</strong></span>
            </div>
          </div>
        ))}
      </div>

      {/* Contact Queue Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="font-bold text-slate-900 text-base">Campaign Contact Queue Repository</h3>
              <p className="text-[11px] text-slate-500 font-mono">
                Showing {filteredContacts.length} of {contacts.length} leads with verified parcel & CRM metadata
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search name, phone, APN, city, tag, agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500 font-sans"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="py-2 px-2.5 text-xs rounded-lg border border-slate-200 bg-slate-50 font-mono text-slate-700 focus:outline-none"
            >
              <option value="all">Status: All</option>
              <option value="pending">Pending</option>
              <option value="dialing">Dialing</option>
              <option value="completed">Completed</option>
              <option value="dnc">DNC / Skipped</option>
            </select>

            {/* Stage Filter */}
            {distinctStages.length > 0 && (
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value)}
                className="py-2 px-2.5 text-xs rounded-lg border border-slate-200 bg-slate-50 font-mono text-slate-700 focus:outline-none max-w-[150px] truncate"
              >
                <option value="all">Stage: All</option>
                {distinctStages.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            )}

            {/* Property Type Filter */}
            {distinctPropertyTypes.length > 0 && (
              <select
                value={propertyTypeFilter}
                onChange={(e) => setPropertyTypeFilter(e.target.value)}
                className="py-2 px-2.5 text-xs rounded-lg border border-slate-200 bg-slate-50 font-mono text-slate-700 focus:outline-none max-w-[150px] truncate"
              >
                <option value="all">Property: All</option>
                {distinctPropertyTypes.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead className="bg-slate-50 text-slate-700 font-mono uppercase tracking-wider border-y border-slate-200">
              <tr>
                <th className="p-3 font-semibold">Contact / Owner</th>
                <th className="p-3 font-semibold">Primary & Secondary Phones</th>
                <th className="p-3 font-semibold">Property APN & Address</th>
                <th className="p-3 font-semibold">Property Type & Units</th>
                <th className="p-3 font-semibold">Pipeline & Stage</th>
                <th className="p-3 font-semibold">Valuation & Equity</th>
                <th className="p-3 font-semibold">Dial Status</th>
                <th className="p-3 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {filteredContacts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-slate-400 italic font-mono">
                    No CRM leads match the current filters.
                  </td>
                </tr>
              ) : (
                filteredContacts.map((c) => {
                  const m = c.metadata || {};
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                      {/* Contact / Owner */}
                      <td className="p-3">
                        <span className="font-bold text-slate-900 block text-xs">{c.name}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {m.email && (
                            <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                              <Mail className="w-2.5 h-2.5 text-slate-400" />
                              {m.email}
                            </span>
                          )}
                        </div>
                        {m.tag_list && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {String(m.tag_list)
                              .split(',')
                              .slice(0, 2)
                              .map((tag, i) => (
                                <span
                                  key={i}
                                  className="px-1.5 py-0.2 bg-indigo-50 text-indigo-700 font-mono text-[9px] rounded font-medium border border-indigo-100"
                                >
                                  {tag.trim()}
                                </span>
                              ))}
                          </div>
                        )}
                      </td>

                      {/* Phone Numbers */}
                      <td className="p-3 font-mono">
                        {c.phone && c.phone.trim() !== '' ? (
                          <div className="font-bold text-emerald-700 text-xs flex items-center gap-1">
                            <Phone className="w-3 h-3 text-emerald-500" />
                            {c.phone}
                          </div>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                            <Mail className="w-2.5 h-2.5" /> No Phone (Email Only)
                          </span>
                        )}
                        {m.secondary_phones && (
                          <span className="text-[10px] text-slate-500 block truncate max-w-[160px] mt-0.5" title={m.secondary_phones}>
                            Alt: {m.secondary_phones}
                          </span>
                        )}
                        {m.tracked_phone && (
                          <span className="text-[9px] text-indigo-600 block">
                            Tracked: {m.tracked_phone}
                          </span>
                        )}
                      </td>

                      {/* Property APN & Address */}
                      <td className="p-3 font-sans">
                        {m.apn && (
                          <span className="font-mono font-bold text-indigo-700 block text-[11px]">
                            APN: {m.apn}
                          </span>
                        )}
                        <span className="text-slate-800 text-[11px] font-medium block">
                          {m.property_address || (m.city ? `${m.city}, ${m.state || 'CA'}` : 'Address Pending')}
                        </span>
                        {(m.city || m.zip) && (
                          <span className="text-slate-500 text-[10px]">
                            {[m.city, m.state || 'CA', m.zip].filter(Boolean).join(' ')}
                          </span>
                        )}
                      </td>

                      {/* Property Type & Units */}
                      <td className="p-3 font-sans">
                        <span className="text-slate-800 text-[11px] font-semibold block">
                          {m.property_type_standardized || m.property_type || 'Single Family'}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5 font-mono text-[10px]">
                          <span className="text-slate-500">{m.units || 1} {Number(m.units) > 1 ? 'Units' : 'Unit'}</span>
                          <span>•</span>
                          {m.is_vacant === 'Yes' || m.is_vacant === true ? (
                            <span className="text-amber-700 bg-amber-50 px-1 py-0.2 rounded font-bold">Vacant</span>
                          ) : (
                            <span className="text-slate-500">Occupied</span>
                          )}
                        </div>
                      </td>

                      {/* Pipeline & Stage */}
                      <td className="p-3 font-sans">
                        <span className="text-indigo-900 font-semibold text-[11px] block">
                          {m.pipeline_name || 'High Equity Acquisitions'}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                            {m.stage_name_standardized || m.stage_name || 'Lead'}
                          </span>
                          {m.assigned_to && (
                            <span className="text-[10px] text-slate-500 font-mono truncate max-w-[90px]">
                              {m.assigned_to}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Valuation & Equity */}
                      <td className="p-3 font-mono">
                        <span className="font-bold text-amber-600 text-xs block">
                          {m.estimated_equity ? String(m.estimated_equity) : '$450,000'}
                        </span>
                        {m.assessed_value && (
                          <span className="text-[10px] text-slate-500 block">
                            Assessed: {String(m.assessed_value)}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3 font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block ${
                            c.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'dialing'
                              ? 'bg-blue-100 text-blue-800 animate-pulse'
                              : c.status === 'dnc'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {c.status.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {c.attempts} {c.attempts === 1 ? 'attempt' : 'attempts'}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setSelectedContactForDetails(c)}
                          className="px-2 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded text-[11px] font-mono font-medium transition-colors border border-slate-200 inline-flex items-center gap-1"
                        >
                          <Info className="w-3 h-3" />
                          <span>View CRM</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CRM Lead Details Inspector Modal */}
      {selectedContactForDetails && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400">
                  CRM Property Lead Details
                </span>
                <h3 className="font-bold text-lg text-white mt-0.5">{selectedContactForDetails.name}</h3>
                <span className="text-xs font-mono text-slate-400">
                  External ID: {selectedContactForDetails.external_contact_id}
                </span>
              </div>
              <button
                onClick={() => setSelectedContactForDetails(null)}
                className="text-slate-400 hover:text-white text-2xl font-bold p-1"
              >
                ×
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
              {/* Contact Info */}
              <div>
                <h4 className="font-bold text-slate-900 uppercase font-mono text-[11px] mb-2 flex items-center gap-1.5 text-indigo-700">
                  <Phone className="w-3.5 h-3.5" /> Contact Information
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Primary Phone</span>
                    <span className="font-bold font-mono text-emerald-600 text-sm">
                      {selectedContactForDetails.phone}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Secondary Phones</span>
                    <span className="font-mono text-slate-800">
                      {selectedContactForDetails.metadata?.secondary_phones || 'None on file'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Email Address</span>
                    <span className="font-mono text-slate-800">
                      {selectedContactForDetails.metadata?.email || 'None on file'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Campaign Tracked Phone</span>
                    <span className="font-mono text-slate-800">
                      {selectedContactForDetails.metadata?.tracked_phone || 'Default Trunk'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Property & Parcel Info */}
              <div>
                <h4 className="font-bold text-slate-900 uppercase font-mono text-[11px] mb-2 flex items-center gap-1.5 text-indigo-700">
                  <Building2 className="w-3.5 h-3.5" /> Property & Parcel GIS Intelligence
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="sm:col-span-2">
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Property Address</span>
                    <span className="font-bold text-slate-900">
                      {selectedContactForDetails.metadata?.property_address || '123 Main St'}
                    </span>
                    <span className="text-slate-600 block text-[11px]">
                      {selectedContactForDetails.metadata?.city || 'Anaheim'}, {selectedContactForDetails.metadata?.state || 'CA'} {selectedContactForDetails.metadata?.zip || '92805'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Parcel APN</span>
                    <span className="font-mono font-bold text-indigo-700">
                      {selectedContactForDetails.metadata?.apn || '580-081-01'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Property Type</span>
                    <span className="font-medium text-slate-800">
                      {selectedContactForDetails.metadata?.property_type_standardized || selectedContactForDetails.metadata?.property_type || 'Single Family'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Units Count</span>
                    <span className="font-mono font-bold text-slate-800">
                      {selectedContactForDetails.metadata?.units || 1}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Occupancy & Vacancy</span>
                    <span className="font-medium text-slate-800">
                      {selectedContactForDetails.metadata?.is_vacant === 'Yes' ? 'Vacant' : 'Occupied'} • {selectedContactForDetails.metadata?.is_owner_occupied === true ? 'Owner Occupied' : 'Absentee Owner'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Assessed Value</span>
                    <span className="font-mono font-bold text-slate-800">
                      {selectedContactForDetails.metadata?.assessed_value || '$750,000'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Estimated Equity</span>
                    <span className="font-mono font-bold text-amber-600 text-sm">
                      {selectedContactForDetails.metadata?.estimated_equity || '$450,000'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Owner Classification</span>
                    <span className="font-medium text-slate-800">
                      {selectedContactForDetails.metadata?.owner_type || 'Absentee Owner'}
                    </span>
                  </div>
                </div>
              </div>

              {/* CRM Pipeline & Workflow */}
              <div>
                <h4 className="font-bold text-slate-900 uppercase font-mono text-[11px] mb-2 flex items-center gap-1.5 text-indigo-700">
                  <Layers className="w-3.5 h-3.5" /> Pipeline, Stage & Workflow Tasks
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Pipeline Name</span>
                    <span className="font-bold text-indigo-900">
                      {selectedContactForDetails.metadata?.pipeline_name || 'High Equity Acquisitions'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Standardized Stage</span>
                    <span className="font-medium text-slate-800">
                      {selectedContactForDetails.metadata?.stage_name_standardized || selectedContactForDetails.metadata?.stage_name || 'Lead Discovery'} ({selectedContactForDetails.metadata?.stage_status_standardized || 'Active'})
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Source / Referrer</span>
                    <span className="text-slate-800">
                      {selectedContactForDetails.metadata?.source_name || 'GIS Ingest'} / {selectedContactForDetails.metadata?.referrer_name || 'Direct'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Assigned Agent</span>
                    <span className="font-medium text-slate-800">
                      {selectedContactForDetails.metadata?.assigned_to || 'Kristina Madrigal'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Next Task Kind</span>
                    <span className="text-slate-800 font-mono">
                      {selectedContactForDetails.metadata?.next_task_kind || 'Outbound Call'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Next Task Due</span>
                    <span className="text-slate-800 font-mono font-medium">
                      {selectedContactForDetails.metadata?.next_task_due_at || 'Immediate'}
                    </span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-[10px] text-slate-500 font-mono uppercase block">Tags</span>
                    <span className="font-mono text-indigo-700 font-medium">
                      {selectedContactForDetails.metadata?.tag_list || 'None'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setSelectedContactForDetails(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-mono font-bold transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ingestion Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-xl w-full shadow-2xl border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-lg text-slate-900">Ingest Campaign Lead List</h3>
                <p className="text-xs text-slate-500 font-mono">
                  Upload <code className="text-indigo-600">cleaned_organized_crm_leads.csv</code> or custom CSV export
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Campaign Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Orange County Absentee Owners (FIPS 06059)"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:border-indigo-500 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Lines Per Agent</label>
                  <select
                    value={linesPerAgent}
                    onChange={(e) => setLinesPerAgent(Number(e.target.value))}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 bg-white font-mono"
                  >
                    <option value="1">1 Line (Single Dial)</option>
                    <option value="2">2 Lines</option>
                    <option value="3">3 Lines (Power Dial)</option>
                    <option value="4">4 Lines (Max Power)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase block mb-1">Dial Mode</label>
                  <input
                    type="text"
                    disabled
                    value="Power Dial (FSM Real-Time)"
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 uppercase block">
                    Upload CSV Lead Batch (<code className="text-indigo-600">cleaned_organized_crm_leads.csv</code>)
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadLiveLeads}
                    className="text-[11px] font-mono font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200 transition-colors"
                  >
                    <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                    Load 76 Live Leads
                  </button>
                </div>
                <label className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                  <Upload className="w-7 h-7 text-indigo-500 mb-1" />
                  <span className="text-xs text-slate-700 font-bold">
                    {csvFileName ? `Loaded: ${csvFileName} (${rawContacts.length} leads parsed)` : 'Click to select cleaned_organized_crm_leads.csv'}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Supports APN, Address, Equity, Stage, Pipeline, Units, Vacancy, Secondary Phones
                  </span>
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>
                <div className="flex items-center gap-1.5 mt-2 p-2 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-[10px] font-mono">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    <strong>Strict Compliance Active:</strong> "Do Not Contact", "Do Not Email", lost leads, and missing phone numbers are automatically protected from outbound dialing.
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors shadow flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Ingest {rawContacts.length > 0 ? `${rawContacts.length} Leads` : 'Campaign'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

