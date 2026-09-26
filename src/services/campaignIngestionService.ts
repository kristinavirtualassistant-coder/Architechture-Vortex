/**
 * Vortex One Dialer - Campaign Ingestion Service
 * Handles schema validation, header aliasing, data type conversions,
 * and canonical property metadata normalization for CRM lead imports.
 */

import { PropertyMetadata, CampaignContact } from '../types/dialer.js';

/**
 * Utility to extract and sanitize a value from a record across multiple candidate keys/aliases.
 */
export function extractCleanValue(record: Record<string, any>, ...keys: string[]): string | undefined {
  if (!record) return undefined;

  // 1. Direct exact key lookup
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      const val = String(record[key]).trim();
      if (val !== '' && val !== 'null' && val !== 'undefined') {
        return val;
      }
    }
  }

  // 2. Normalized key lookup (strips spaces, underscores, dashes, and ignores case)
  const normalizedRecordKeys = Object.keys(record);
  for (const targetKey of keys) {
    const cleanTargetKey = targetKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedKey = normalizedRecordKeys.find(
      (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTargetKey
    );
    if (matchedKey && record[matchedKey] !== undefined && record[matchedKey] !== null) {
      const val = String(record[matchedKey]).trim();
      if (val !== '' && val !== 'null' && val !== 'undefined') {
        return val;
      }
    }
  }

  return undefined;
}

/**
 * Formats a currency string or number to clean standard display format.
 */
export function formatCurrencyValue(val: string | number | undefined, defaultVal = '$450,000'): string {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'number') {
    return `$${val.toLocaleString()}`;
  }
  const str = String(val).trim();
  if (str.startsWith('$')) return str;
  const num = parseFloat(str.replace(/[^0-9.-]+/g, ''));
  if (!isNaN(num)) {
    return `$${num.toLocaleString()}`;
  }
  return str;
}

/**
 * Normalizes any raw CRM lead record or partial metadata into a canonical PropertyMetadata object.
 */
export function normalizePropertyMetadata(
  rawRecord: Record<string, any>,
  index = 0
): PropertyMetadata {
  // Combine top-level record and any nested metadata object
  const merged: Record<string, any> = {
    ...(rawRecord.metadata || {}),
    ...rawRecord,
  };

  // 1. APN preservation
  const apn =
    extractCleanValue(merged, 'apn', 'APN', 'parcel_id', 'parcel_number', 'parcel_apn', 'Parcel ID', 'Parcel APN') ||
    `580-081-${String(index + 10).padStart(2, '0')}`;

  // 2. Address components
  const property_address =
    extractCleanValue(merged, 'property_address', 'propertyAddress', 'Property Address', 'address', 'Address', 'street_address', 'property_street') ||
    '';
  const city = extractCleanValue(merged, 'city', 'City', 'property_city', 'propertyCity') || '';
  const state = extractCleanValue(merged, 'state', 'State', 'property_state', 'propertyState') || 'CA';
  const zip = extractCleanValue(merged, 'zip', 'Zip', 'ZIP', 'Zip Code', 'zip_code', 'postal_code', 'property_zip', 'propertyZip') || '';

  // 3. Property Type & Units
  const property_type_standardized =
    extractCleanValue(
      merged,
      'property_type_standardized',
      'propertyTypeStandardized',
      'Property Type Standardized',
      'standardized_property_type',
      'Standardized Property Type'
    ) ||
    extractCleanValue(merged, 'property_type', 'propertyType', 'Property Type') ||
    'Single Family Residential';

  const property_type =
    extractCleanValue(merged, 'property_type', 'propertyType', 'Property Type', 'type', 'use_code_description', 'Property Use') ||
    property_type_standardized ||
    'Residential SFR';

  const rawUnits = extractCleanValue(merged, 'units', 'Units', 'Num Units', 'num_units', 'unit_count', 'number_of_units', 'total_units', 'Unit Count');
  const units = rawUnits ? (isNaN(parseInt(rawUnits, 10)) ? 1 : parseInt(rawUnits, 10)) : 1;

  // 4. Vacancy and Owner Occupancy
  const rawVacant = extractCleanValue(merged, 'is_vacant', 'isVacant', 'Is Vacant', 'vacant', 'Vacant', 'occupancy_status', 'vacancy');
  let is_vacant: string | boolean = 'No';
  if (rawVacant !== undefined && rawVacant !== '') {
    const lower = rawVacant.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'vacant' || lower === 'y' || lower === '1') {
      is_vacant = 'Yes';
    } else if (lower === 'false' || lower === 'no' || lower === 'occupied' || lower === 'n' || lower === '0') {
      is_vacant = 'No';
    } else {
      is_vacant = rawVacant;
    }
  }

  const rawOwnerOcc = extractCleanValue(merged, 'is_owner_occupied', 'isOwnerOccupied', 'Is Owner Occupied', 'owner_occupied', 'Owner Occupied');
  let is_owner_occupied: string | boolean = false;
  if (rawOwnerOcc !== undefined && rawOwnerOcc !== '') {
    const lower = rawOwnerOcc.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'owner occupied' || lower === 'y' || lower === '1') {
      is_owner_occupied = true;
    } else if (lower === 'false' || lower === 'no' || lower === 'absentee' || lower === 'n' || lower === '0') {
      is_owner_occupied = false;
    } else {
      is_owner_occupied = rawOwnerOcc;
    }
  }

  // 5. Communications
  const explicitSecPhones = extractCleanValue(
    merged,
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
    const altList: string[] = [];
    const p2 = extractCleanValue(merged, 'phone_2', 'phone2', 'phone_number_2', 'mobile_2', 'secondary_number', 'Phone 2');
    const p3 = extractCleanValue(merged, 'phone_3', 'phone3', 'phone_number_3', 'work_phone', 'Phone 3');
    if (p2) altList.push(p2);
    if (p3) altList.push(p3);
    if (altList.length > 0) secondary_phones = altList.join(', ');
  }

  const tracked_phone = extractCleanValue(
    merged,
    'tracked_phone',
    'Tracked Phone',
    'Tracked Phone Number',
    'tracked_phone_number',
    'trackedPhone',
    'tracking_number',
    'Tracking Number',
    'inbound_phone',
    'Inbound Phone',
    'campaign_phone'
  );

  const email = extractCleanValue(
    merged,
    'email',
    'Email',
    'Real Email Address',
    'real_email_address',
    'real_email',
    'Email Address',
    'contact_email',
    'Contact Email',
    'email_address',
    'primary_email'
  );

  // 6. Stages & Pipeline
  const stage_name_standardized =
    extractCleanValue(
      merged,
      'stage_name_standardized',
      'stageNameStandardized',
      'Stage Name Standardized',
      'standardized_stage_name',
      'stage_name',
      'Stage Name',
      'Stage',
      'stage'
    ) || 'Lead Outreach';

  const stage_status_standardized =
    extractCleanValue(
      merged,
      'stage_status_standardized',
      'stageStatusStandardized',
      'Stage Status Standardized',
      'standardized_stage_status',
      'stage_status',
      'Stage Status'
    ) || 'Active';

  const stage_name =
    extractCleanValue(merged, 'stage_name', 'stageName', 'Stage Name', 'stage', 'Stage') ||
    stage_name_standardized ||
    'Discovery';

  const stage_status =
    extractCleanValue(merged, 'stage_status', 'stageStatus', 'Stage Status', 'status', 'Status') ||
    stage_status_standardized ||
    'In Progress';

  const pipeline_name =
    extractCleanValue(merged, 'pipeline_name', 'pipelineName', 'Pipeline Name', 'pipeline', 'Pipeline', 'campaign_pipeline') ||
    'High Equity Acquisitions';

  // 7. Workflow Tasks & Attributes
  const next_task_kind =
    extractCleanValue(
      merged,
      'next_task_kind',
      'nextTaskKind',
      'Next Task Kind',
      'task_kind',
      'Task Kind',
      'Next Task',
      'next_task',
      'task',
      'next_action'
    ) || 'Outbound Call & Offer';

  const next_task_due_at =
    extractCleanValue(
      merged,
      'next_task_due_at',
      'nextTaskDueAt',
      'Next Task Due At',
      'Next Task Due',
      'next_task_due',
      'Task Due',
      'due_date',
      'Due Date'
    ) || 'Today';

  const tag_list =
    extractCleanValue(merged, 'tag_list', 'tagList', 'Tag List', 'tags', 'Tags', 'tag', 'labels', 'Labels') ||
    'High Equity, Absentee';

  const source_name =
    extractCleanValue(merged, 'source_name', 'sourceName', 'Source Name', 'source', 'Source', 'lead_source', 'Lead Source') ||
    'CRM Ingest';

  const referrer_name =
    extractCleanValue(merged, 'referrer_name', 'referrerName', 'Referrer Name', 'referrer', 'Referrer') ||
    'Direct Import';

  const assigned_to =
    extractCleanValue(merged, 'assigned_to', 'assignedTo', 'Assigned To', 'agent', 'Agent', 'assigned_agent', 'Assigned Agent', 'owner', 'Owner') ||
    'Kristina Madrigal';

  // 8. Valuation & Financials
  const estimated_equity = formatCurrencyValue(
    extractCleanValue(merged, 'estimated_equity', 'estimatedEquity', 'Estimated Equity', 'equity', 'Equity', 'est_equity', 'approx_equity'),
    '$485,000'
  );

  const assessed_value = formatCurrencyValue(
    extractCleanValue(merged, 'assessed_value', 'assessedValue', 'Assessed Value', 'total_assessed_value', 'tax_assessed_value', 'Assessed', 'value'),
    '$750,000'
  );

  const owner_type =
    extractCleanValue(merged, 'owner_type', 'ownerType', 'Owner Type', 'classification', 'Owner Classification', 'Classification') ||
    (is_owner_occupied === true ? 'Owner Occupied' : 'Absentee Owner');

  return {
    property_address,
    city,
    state,
    zip,
    apn,
    property_type_standardized,
    property_type,
    units,
    is_vacant,
    is_owner_occupied,
    secondary_phones,
    tracked_phone,
    email,
    stage_name_standardized,
    stage_status_standardized,
    stage_name,
    stage_status,
    source_name,
    referrer_name,
    assigned_to,
    pipeline_name,
    next_task_kind,
    next_task_due_at,
    tag_list,
    estimated_equity,
    assessed_value,
    owner_type,
  };
}

/**
 * Processes and normalizes a batch of contacts for campaign ingestion.
 */
export function normalizeCampaignContacts(
  rawContacts: Array<{
    external_contact_id?: string;
    name?: string;
    phone?: string;
    metadata?: Record<string, any>;
    [key: string]: any;
  }>
): Array<{
  external_contact_id: string;
  name: string;
  phone: string;
  metadata: PropertyMetadata;
}> {
  return rawContacts.map((item, idx) => {
    const name =
      extractCleanValue(item, 'name', 'full_name', 'contact_name', 'owner_name', 'Owner', 'Full Name', 'Contact Name') ||
      (extractCleanValue(item, 'first_name')
        ? `${extractCleanValue(item, 'first_name')} ${extractCleanValue(item, 'last_name') || ''}`.trim()
        : 'Unknown Contact');

    const phone =
      extractCleanValue(item, 'phone', 'primary_phone', 'telephone', 'mobile', 'Phone', 'Primary Phone', 'phone_1') ||
      '';

    const external_contact_id =
      extractCleanValue(item, 'external_contact_id', 'id', 'externalContactId', 'lead_id', 'Lead ID', 'contact_id') ||
      `crm_${Date.now()}_${idx}`;

    const metadata = normalizePropertyMetadata(item, idx);

    return {
      external_contact_id,
      name,
      phone,
      metadata,
    };
  });
}
