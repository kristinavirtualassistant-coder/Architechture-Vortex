import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from 'recharts';
import * as d3 from 'd3';
import {
  BarChart3,
  TrendingUp,
  PhoneCall,
  Clock,
  CheckCircle2,
  RefreshCw,
  Zap,
  Activity,
  Layers,
  Sparkles,
  Calendar,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Sliders,
} from 'lucide-react';
import {
  DispositionStatItem,
  HourlyPerformanceItem,
  SessionDispositionStats,
} from '../types/dialer';

interface DispositionBarChartProps {
  sessionId?: string;
  initialStats?: SessionDispositionStats | null;
  onRefresh?: () => void;
  className?: string;
}

// Fallback initial state if no calls have occurred yet
const DEFAULT_CHART_DATA: DispositionStatItem[] = [
  { name: 'Interested', key: 'INTERESTED', count: 0, color: '#10b981', category: 'positive' },
  { name: 'Callback', key: 'CALLBACK', count: 0, color: '#f59e0b', category: 'followup' },
  { name: 'Left VM', key: 'LEFT_VM', count: 0, color: '#8b5cf6', category: 'followup' },
  { name: 'No Answer', key: 'NO_ANSWER', count: 0, color: '#64748b', category: 'unreached' },
  { name: 'Busy', key: 'BUSY', count: 0, color: '#94a3b8', category: 'unreached' },
  { name: 'Not Interested', key: 'NOT_INTERESTED', count: 0, color: '#f43f5e', category: 'negative' },
  { name: 'DNC', key: 'DNC', count: 0, color: '#e11d48', category: 'dnc' },
];

export const DispositionBarChart: React.FC<DispositionBarChartProps> = ({
  sessionId,
  initialStats,
  onRefresh,
  className = '',
}) => {
  const [stats, setStats] = useState<SessionDispositionStats | null>(initialStats || null);
  
  // Time-Series & Interactive Filter States
  const [timeScope, setTimeScope] = useState<'hourly' | 'session'>('hourly');
  const [metricView, setMetricView] = useState<'volume' | 'rates' | 'duration' | 'disposition'>('volume');
  const [filterMode, setFilterMode] = useState<'all' | 'connected'>('all');
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [activeBarKey, setActiveBarKey] = useState<string | null>(null);

  // Sync with prop updates
  useEffect(() => {
    if (initialStats) {
      setStats(initialStats);
      setLastUpdated(new Date());
    }
  }, [initialStats]);

  // Fetch real-time disposition statistics if sessionId is available
  const fetchSessionStats = async () => {
    if (!sessionId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/dialer/sessions/${sessionId}/dispositions`);
      if (res.ok) {
        const data: SessionDispositionStats = await res.json();
        setStats(data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.warn('Failed to fetch session disposition stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionStats();
    // Periodic refresh polling as a real-time fallback
    const interval = setInterval(fetchSessionStats, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Format seconds to mm:ss using mathematical precision
  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Hourly time series data
  const hourlyData = useMemo<HourlyPerformanceItem[]>(() => {
    if (stats?.hourlyTimeSeries && stats.hourlyTimeSeries.length > 0) {
      return stats.hourlyTimeSeries;
    }
    // Fallback template hours if session is starting
    const hours = [9, 10, 11, 12, 13, 14, 15, 16];
    return hours.map((h) => {
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      return {
        hourLabel: `${displayHour}:00 ${ampm}`,
        hourKey: `hour_${h.toString().padStart(2, '0')}`,
        hourNumber: h,
        totalCalls: 0,
        connectedCount: 0,
        positiveLeads: 0,
        connectRate: 0,
        positiveRate: 0,
        avgDurationSeconds: 0,
        totalDurationSeconds: 0,
        dispositionCounts: {
          INTERESTED: 0,
          CALLBACK: 0,
          NO_ANSWER: 0,
          BUSY: 0,
          NOT_INTERESTED: 0,
          LEFT_VM: 0,
          DNC: 0,
          FAILED: 0,
          OTHER: 0,
        },
        chartData: DEFAULT_CHART_DATA,
      };
    });
  }, [stats?.hourlyTimeSeries]);

  // Selected hour item if an agent drills into a specific hour
  const activeHourlyItem = useMemo(() => {
    if (!selectedHourKey) return null;
    return hourlyData.find((h) => h.hourKey === selectedHourKey) || null;
  }, [selectedHourKey, hourlyData]);

  // Determine active dataset for categorical dispositions
  const rawChartData = useMemo(() => {
    if (timeScope === 'hourly' && activeHourlyItem) {
      return activeHourlyItem.chartData;
    }
    return stats?.chartData || DEFAULT_CHART_DATA;
  }, [timeScope, activeHourlyItem, stats?.chartData]);

  // Filter connected vs all outcomes
  const filteredDispositionData = useMemo(() => {
    if (filterMode === 'connected') {
      return rawChartData.filter((d) => d.key !== 'NO_ANSWER' && d.key !== 'BUSY' && d.key !== 'FAILED');
    }
    return rawChartData;
  }, [rawChartData, filterMode]);

  const totalFilteredCount = filteredDispositionData.reduce((sum, item) => sum + item.count, 0);

  const chartDataWithPercentages = useMemo(() => {
    return filteredDispositionData.map((item) => ({
      ...item,
      percentage: totalFilteredCount > 0 ? Math.round((item.count / totalFilteredCount) * 100) : 0,
    }));
  }, [filteredDispositionData, totalFilteredCount]);

  // D3 Calculation: Compute trend metrics & sparkline scale
  const d3Metrics = useMemo(() => {
    const totalCallsArray = hourlyData.map((d) => d.totalCalls);
    const connectRatesArray = hourlyData.map((d) => d.connectRate);
    
    const maxCalls = Number(d3.max(totalCallsArray) ?? 1);
    const avgConnectRate = Number(d3.mean(connectRatesArray) ?? 0);
    
    const callScale = d3.scaleLinear().domain([0, maxCalls]).range([0, 100]);
    const rateScale = d3.scaleLinear<string, string>().domain([0, 100]).range(['#ef4444', '#10b981']);

    return {
      maxCalls,
      avgConnectRate: Math.round(avgConnectRate),
      callScale,
      rateScale,
    };
  }, [hourlyData]);

  // Effective Display KPIs (reflects selected hour or entire session)
  const displayTotalCalls = activeHourlyItem ? activeHourlyItem.totalCalls : (stats?.totalCalls || 0);
  const displayConnectedCount = activeHourlyItem ? activeHourlyItem.connectedCount : (stats?.connectedCount || 0);
  const displayConnectRate = activeHourlyItem ? activeHourlyItem.connectRate : (stats?.connectRate || 0);
  const displayPositiveRate = activeHourlyItem ? activeHourlyItem.positiveRate : (stats?.positiveRate || 0);
  const displayAvgDuration = activeHourlyItem ? activeHourlyItem.avgDurationSeconds : (stats?.avgDurationSeconds || 0);
  const displayPositiveCount = activeHourlyItem
    ? (activeHourlyItem.dispositionCounts?.INTERESTED || 0) + (activeHourlyItem.dispositionCounts?.CALLBACK || 0)
    : (stats?.dispositionCounts?.INTERESTED || 0) + (stats?.dispositionCounts?.CALLBACK || 0);

  // Custom Chart Tooltips
  const CustomHourlyTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as HourlyPerformanceItem;
      return (
        <div className="p-3 bg-slate-950/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md text-xs font-mono min-w-[200px] z-50">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
            <span className="font-bold text-slate-100 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>{label || data.hourLabel}</span>
            </span>
            <span className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-800">
              Hourly Slice
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-slate-300">
              <span>Total Dispatched:</span>
              <span className="font-bold text-white">{data.totalCalls} calls</span>
            </div>
            <div className="flex justify-between text-emerald-400">
              <span>Answered / Connected:</span>
              <span className="font-bold">{data.connectedCount} calls ({data.connectRate}%)</span>
            </div>
            <div className="flex justify-between text-amber-400">
              <span>Positive Leads:</span>
              <span className="font-bold">{data.positiveLeads} ({data.positiveRate}%)</span>
            </div>
            <div className="flex justify-between text-purple-300">
              <span>Avg Talk Duration:</span>
              <span className="font-bold">{formatDuration(data.avgDurationSeconds)}</span>
            </div>
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-900 text-[10px] text-slate-400 text-center">
            Click bar to lock filter to this hour
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomDispositionTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: DispositionStatItem & { percentage: number } = payload[0].payload;
      return (
        <div className="p-3 bg-slate-950/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md text-xs font-mono min-w-[180px] z-50">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
              <span className="font-bold text-slate-100">{data.name}</span>
            </div>
            <span className="text-[10px] uppercase font-bold text-slate-400">
              {data.category}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-slate-300">
              <span>Count:</span>
              <span className="font-bold text-white text-sm">{data.count} calls</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Share:</span>
              <span className="font-bold text-amber-400">{data.percentage}% of outcomes</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`bg-slate-900 rounded-xl p-4 sm:p-5 border border-slate-800 shadow-xl space-y-4 ${className}`}>
      
      {/* Top Header & Interactive Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        
        {/* Title & Live Status */}
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-mono font-bold text-slate-100 text-sm uppercase tracking-wider">
                Call Performance & Analytics
              </h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live D3/Recharts
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              {timeScope === 'hourly'
                ? selectedHourKey
                  ? `Filtered: ${activeHourlyItem?.hourLabel} Call Metrics`
                  : 'Time-series hourly velocity across active dialing shifts'
                : 'Session-wide cumulative performance aggregate'}
            </p>
          </div>
        </div>

        {/* Primary Controls: Hourly vs Session-Wide Toggle + Sub-filters */}
        <div className="flex flex-wrap items-center gap-2">
          
          {/* Main Time-Series Filter Mode: Hourly vs Session-Wide */}
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-mono">
            <button
              onClick={() => {
                setTimeScope('hourly');
              }}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer text-xs flex items-center gap-1.5 ${
                timeScope === 'hourly'
                  ? 'bg-indigo-600 text-white font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Hourly Time-Series</span>
            </button>

            <button
              onClick={() => {
                setTimeScope('session');
                setSelectedHourKey(null);
              }}
              className={`px-3 py-1.5 rounded-md transition-all cursor-pointer text-xs flex items-center gap-1.5 ${
                timeScope === 'session'
                  ? 'bg-indigo-600 text-white font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Session-Wide</span>
            </button>
          </div>

          {/* Outcome Filter (All vs Connected Only) */}
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-2 py-1 rounded-md transition-colors cursor-pointer text-[11px] ${
                filterMode === 'all'
                  ? 'bg-slate-800 text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Calls
            </button>
            <button
              onClick={() => setFilterMode('connected')}
              className={`px-2 py-1 rounded-md transition-colors cursor-pointer text-[11px] ${
                filterMode === 'connected'
                  ? 'bg-slate-800 text-white font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Connected Only
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => {
              fetchSessionStats();
              if (onRefresh) onRefresh();
            }}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh statistics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Metric Dimension View Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/80 p-1 rounded-lg border border-slate-800/80 text-xs font-mono">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          <span className="text-[10px] uppercase font-bold text-slate-400 px-2 flex items-center gap-1">
            <Sliders className="w-3 h-3" /> Metric:
          </span>
          <button
            onClick={() => setMetricView('volume')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] ${
              metricView === 'volume'
                ? 'bg-slate-800 text-cyan-400 font-bold border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Call Volume & Connects
          </button>
          <button
            onClick={() => setMetricView('rates')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] ${
              metricView === 'rates'
                ? 'bg-slate-800 text-emerald-400 font-bold border border-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Connect & Conversion Rates (%)
          </button>
          <button
            onClick={() => setMetricView('duration')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] ${
              metricView === 'duration'
                ? 'bg-slate-800 text-purple-300 font-bold border border-purple-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Talk Duration (mm:ss)
          </button>
          <button
            onClick={() => setMetricView('disposition')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer text-[11px] ${
              metricView === 'disposition'
                ? 'bg-slate-800 text-amber-400 font-bold border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Outcome Breakdown
          </button>
        </div>

        {/* Selected Hour Reset Pill if filtering by hour */}
        {timeScope === 'hourly' && selectedHourKey && (
          <div className="flex items-center gap-2 pl-2">
            <span className="text-[10px] text-amber-300 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
              Locked to {activeHourlyItem?.hourLabel}
            </span>
            <button
              onClick={() => setSelectedHourKey(null)}
              className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              Reset to All Hours
            </button>
          </div>
        )}
      </div>

      {/* KPI Metric Strip - Dynamically updates based on timeScope or selected hour */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Total Calls */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>{selectedHourKey ? 'Hourly Dialed' : 'Total Dialed'}</span>
            <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono text-white tracking-tight">
              {displayTotalCalls}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {displayConnectedCount} answered
            </span>
          </div>
        </div>

        {/* Connect Rate */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Connect Rate</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono text-emerald-400 tracking-tight">
              {displayConnectRate}%
            </span>
            <span className="text-[10px] font-mono text-slate-400 flex items-center gap-0.5">
              {displayConnectRate >= d3Metrics.avgConnectRate ? (
                <ArrowUpRight className="w-3 h-3 text-emerald-400" />
              ) : (
                <ArrowDownRight className="w-3 h-3 text-rose-400" />
              )}
              {selectedHourKey ? 'vs Avg' : 'benchmark'}
            </span>
          </div>
        </div>

        {/* Positive Conversion Rate */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Warm Leads</span>
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono text-amber-400 tracking-tight">
              {displayPositiveRate}%
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {displayPositiveCount} positive
            </span>
          </div>
        </div>

        {/* Avg Talk Time */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Avg Talk Time</span>
            <Clock className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold font-mono text-purple-300 tracking-tight">
              {formatDuration(displayAvgDuration)}
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              per connected call
            </span>
          </div>
        </div>
      </div>

      {/* Main Chart Canvas Container */}
      <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-3">
        
        {/* Render Chart based on timeScope and metricView */}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {timeScope === 'hourly' ? (
              // HOURLY TIME-SERIES VISUALIZATIONS
              metricView === 'volume' ? (
                // 1. Hourly Volume (Total Calls + Connected Calls Composed)
                <ComposedChart
                  data={hourlyData}
                  margin={{ top: 15, right: 15, left: -20, bottom: 20 }}
                  onClick={(state: any) => {
                    if (state?.activePayload && state.activePayload.length) {
                      const clicked = state.activePayload[0].payload as HourlyPerformanceItem;
                      setSelectedHourKey(selectedHourKey === clicked.hourKey ? null : clicked.hourKey);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
                  <XAxis
                    dataKey="hourLabel"
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <Tooltip content={<CustomHourlyTooltip />} cursor={{ fill: 'rgba(99, 102, 241, 0.08)' }} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                  />
                  <Bar
                    dataKey="totalCalls"
                    name="Dispatched Dials"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  >
                    {hourlyData.map((entry) => (
                      <Cell
                        key={`cell-total-${entry.hourKey}`}
                        fill={selectedHourKey === entry.hourKey ? '#6366f1' : '#3b82f6'}
                        opacity={selectedHourKey && selectedHourKey !== entry.hourKey ? 0.35 : 0.85}
                        className="cursor-pointer transition-opacity"
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="connectedCount"
                    name="Connected Calls"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  >
                    {hourlyData.map((entry) => (
                      <Cell
                        key={`cell-conn-${entry.hourKey}`}
                        fill={selectedHourKey === entry.hourKey ? '#34d399' : '#10b981'}
                        opacity={selectedHourKey && selectedHourKey !== entry.hourKey ? 0.35 : 1}
                        className="cursor-pointer transition-opacity"
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="positiveLeads"
                    name="Warm Leads"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#f59e0b' }}
                  />
                </ComposedChart>
              ) : metricView === 'rates' ? (
                // 2. Hourly Connect Rate (%) & Conversion Rate (%) Area Curves
                <AreaChart
                  data={hourlyData}
                  margin={{ top: 15, right: 15, left: -20, bottom: 20 }}
                  onClick={(state: any) => {
                    if (state?.activePayload && state.activePayload.length) {
                      const clicked = state.activePayload[0].payload as HourlyPerformanceItem;
                      setSelectedHourKey(selectedHourKey === clicked.hourKey ? null : clicked.hourKey);
                    }
                  }}
                >
                  <defs>
                    <linearGradient id="connectRateGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="positiveRateGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
                  <XAxis
                    dataKey="hourLabel"
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    unit="%"
                    domain={[0, 100]}
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <Tooltip content={<CustomHourlyTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                  />
                  <ReferenceLine
                    y={d3Metrics.avgConnectRate}
                    stroke="#64748b"
                    strokeDasharray="4 4"
                    label={{
                      value: `Avg: ${d3Metrics.avgConnectRate}%`,
                      fill: '#94a3b8',
                      fontSize: 10,
                      position: 'insideBottomRight',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="connectRate"
                    name="Connect Rate (%)"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#connectRateGradient)"
                  />
                  <Area
                    type="monotone"
                    dataKey="positiveRate"
                    name="Warm Lead Conversion (%)"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#positiveRateGradient)"
                  />
                </AreaChart>
              ) : metricView === 'duration' ? (
                // 3. Hourly Avg Talk Duration (Seconds)
                <BarChart
                  data={hourlyData}
                  margin={{ top: 15, right: 15, left: -20, bottom: 20 }}
                  onClick={(state: any) => {
                    if (state?.activePayload && state.activePayload.length) {
                      const clicked = state.activePayload[0].payload as HourlyPerformanceItem;
                      setSelectedHourKey(selectedHourKey === clicked.hourKey ? null : clicked.hourKey);
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
                  <XAxis
                    dataKey="hourLabel"
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    unit="s"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <Tooltip content={<CustomHourlyTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace', paddingBottom: '8px' }}
                  />
                  <Bar
                    dataKey="avgDurationSeconds"
                    name="Avg Talk Time (seconds)"
                    fill="#8b5cf6"
                    radius={[6, 6, 0, 0]}
                  >
                    {hourlyData.map((entry) => (
                      <Cell
                        key={`cell-dur-${entry.hourKey}`}
                        fill={selectedHourKey === entry.hourKey ? '#c084fc' : '#8b5cf6'}
                        opacity={selectedHourKey && selectedHourKey !== entry.hourKey ? 0.35 : 1}
                        className="cursor-pointer transition-opacity"
                      />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                // 4. Hourly Disposition Distribution
                <BarChart
                  data={chartDataWithPercentages}
                  margin={{ top: 15, right: 10, left: -20, bottom: 20 }}
                  onMouseMove={(state: any) => {
                    if (state?.activePayload && state.activePayload.length) {
                      setActiveBarKey(state.activePayload[0].payload.key);
                    }
                  }}
                  onMouseLeave={() => setActiveBarKey(null)}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
                  <XAxis
                    dataKey="name"
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                    tickLine={{ stroke: '#475569' }}
                  />
                  <Tooltip content={<CustomDispositionTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} animationDuration={500}>
                    {chartDataWithPercentages.map((entry) => (
                      <Cell
                        key={`cell-${entry.key}`}
                        fill={entry.color}
                        opacity={activeBarKey && activeBarKey !== entry.key ? 0.45 : 1}
                        className="transition-opacity duration-200 cursor-pointer"
                      />
                    ))}
                  </Bar>
                </BarChart>
              )
            ) : (
              // SESSION-WIDE CUMULATIVE BAR CHART
              <BarChart
                data={chartDataWithPercentages}
                margin={{ top: 15, right: 10, left: -20, bottom: 20 }}
                onMouseMove={(state: any) => {
                  if (state?.activePayload && state.activePayload.length) {
                    setActiveBarKey(state.activePayload[0].payload.key);
                  }
                }}
                onMouseLeave={() => setActiveBarKey(null)}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.4} />
                <XAxis
                  dataKey="name"
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                  tickLine={{ stroke: '#475569' }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                />
                <YAxis
                  allowDecimals={false}
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                  tickLine={{ stroke: '#475569' }}
                />
                <Tooltip content={<CustomDispositionTooltip />} cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} animationDuration={600}>
                  {chartDataWithPercentages.map((entry) => (
                    <Cell
                      key={`cell-${entry.key}`}
                      fill={entry.color}
                      opacity={activeBarKey && activeBarKey !== entry.key ? 0.45 : 1}
                      className="transition-opacity duration-200 cursor-pointer"
                    />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* Hourly Scrubber Pill Navigation (in Hourly Mode) */}
        {timeScope === 'hourly' && (
          <div className="pt-2 border-t border-slate-900 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center space-x-1 overflow-x-auto py-1 max-w-full">
              <span className="text-[10px] font-mono text-slate-400 px-1">Hour Filter:</span>
              <button
                onClick={() => setSelectedHourKey(null)}
                className={`px-2 py-1 rounded text-[10px] font-mono transition-all cursor-pointer ${
                  !selectedHourKey
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                All Hours
              </button>
              {hourlyData.map((h) => (
                <button
                  key={h.hourKey}
                  onClick={() => setSelectedHourKey(selectedHourKey === h.hourKey ? null : h.hourKey)}
                  className={`px-2 py-1 rounded text-[10px] font-mono transition-all cursor-pointer flex items-center gap-1 ${
                    selectedHourKey === h.hourKey
                      ? 'bg-amber-500 text-slate-950 font-bold border border-amber-400 shadow'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <span>{h.hourLabel}</span>
                  {h.totalCalls > 0 && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-200">
                      {h.totalCalls}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* D3 Calculated Velocity Benchmark */}
            <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 self-end">
              <span>Session Mean Connect:</span>
              <span className="font-bold text-emerald-400">{d3Metrics.avgConnectRate}%</span>
            </div>
          </div>
        )}

        {/* Legend & Breakdown Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-slate-900">
          {chartDataWithPercentages.map((item) => (
            <div
              key={item.key}
              onMouseEnter={() => setActiveBarKey(item.key)}
              onMouseLeave={() => setActiveBarKey(null)}
              className={`flex items-center space-x-1.5 px-2 py-1 rounded-md border text-[11px] font-mono transition-all cursor-pointer ${
                activeBarKey === item.key
                  ? 'bg-slate-800 border-slate-600 scale-105 shadow'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-slate-300 font-medium">{item.name}:</span>
              <span className="font-bold text-white">{item.count}</span>
              <span className="text-[10px] text-slate-400">({item.percentage}%)</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Meta Timestamp */}
      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1">
        <span>Active Dialing Session #{sessionId?.slice(0, 8) || 'current'}</span>
        <span>Auto-synced: {lastUpdated.toLocaleTimeString()}</span>
      </div>
    </div>
  );
};
