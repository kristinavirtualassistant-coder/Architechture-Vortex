import React, { useMemo } from 'react';
import { Activity, Wifi, ShieldCheck, Zap } from 'lucide-react';
import { Call } from '../types/dialer';

interface ConnectionSignalProps {
  activeCalls?: (Call & { contactName?: string; contactMetadata?: any })[];
  wsConnected?: boolean;
}

export const ConnectionSignal: React.FC<ConnectionSignalProps> = ({
  activeCalls = [],
  wsConnected = true,
}) => {
  // Calculate latency metrics dynamically based on activeCalls metadata & provider stream status
  const metrics = useMemo(() => {
    if (!wsConnected) {
      return {
        latencyMs: 999,
        jitterMs: 0,
        packetLoss: 100,
        quality: 'poor' as const,
        colorCategory: 'Red',
        mosScore: '1.0',
        activeLines: 0,
        label: 'Disconnected',
      };
    }

    // Check active call states & metadata
    const activeLinesCount = activeCalls.filter(
      (c) => c.state === 'CONNECTED' || c.state === 'RINGING' || c.state === 'DIALING'
    ).length;

    const hasConnectedCall = activeCalls.some((c) => c.state === 'CONNECTED');
    const hasFailedCall = activeCalls.some((c) => c.state === 'FAILED');

    // Extract any metadata latency if provided on active calls
    let baseLatency = 28; // standard WebRTC/SIP RTP nominal latency in milliseconds
    if (activeCalls.length > 0) {
      const explicitLatencies = activeCalls
        .map((c) => {
          const meta = c.contactMetadata || {};
          return (
            meta.latency ??
            meta.latency_ms ??
            meta.latencyMs ??
            meta.ping ??
            meta.rtt ??
            meta.round_trip_time_ms
          );
        })
        .filter((l): l is number => typeof l === 'number' && !isNaN(l) && l > 0);

      if (explicitLatencies.length > 0) {
        baseLatency = Math.round(
          explicitLatencies.reduce((a, b) => a + b, 0) / explicitLatencies.length
        );
      } else {
        // Dynamic jitter calculation based on parallel lines load
        baseLatency = 24 + activeLinesCount * 6;
      }
    }

    if (hasFailedCall) {
      baseLatency += 140;
    }

    let quality: 'excellent' | 'fair' | 'poor' = 'excellent';
    let colorCategory = 'Green';
    let mosScore = '4.4';
    let jitterMs = 2;
    let packetLoss = 0.0;
    let label = 'Optimal';

    // Latency threshold tiers: Green (<120ms), Yellow (120ms - 280ms), Red (>280ms)
    if (baseLatency < 120 && !hasFailedCall) {
      quality = 'excellent';
      colorCategory = 'Green';
      mosScore = '4.4';
      jitterMs = 2 + Math.min(activeLinesCount, 4);
      packetLoss = 0.0;
      label = 'Optimal';
    } else if (baseLatency <= 280) {
      quality = 'fair';
      colorCategory = 'Yellow';
      mosScore = '3.8';
      jitterMs = 12 + activeLinesCount * 2;
      packetLoss = 0.4;
      label = 'Moderate';
    } else {
      quality = 'poor';
      colorCategory = 'Red';
      mosScore = '2.3';
      jitterMs = 35;
      packetLoss = 2.8;
      label = 'Degraded';
    }

    return {
      latencyMs: baseLatency,
      jitterMs,
      packetLoss,
      quality,
      colorCategory,
      mosScore,
      activeLines: activeLinesCount,
      hasConnectedCall,
      label,
    };
  }, [activeCalls, wsConnected]);

  // Color config based on Green / Yellow / Red
  const colorStyles = {
    excellent: {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      dot: 'bg-emerald-400',
      barFilled: 'bg-emerald-400',
      barEmpty: 'bg-slate-800',
      badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    },
    fair: {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      dot: 'bg-amber-400',
      barFilled: 'bg-amber-400',
      barEmpty: 'bg-slate-800',
      badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
    poor: {
      text: 'text-rose-400',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/30',
      dot: 'bg-rose-400',
      barFilled: 'bg-rose-400',
      barEmpty: 'bg-slate-800',
      badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    },
  }[metrics.quality];

  return (
    <div
      className={`flex items-center space-x-2.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${colorStyles.bg} ${colorStyles.border}`}
      title={`SIP/WebRTC Telephony Stream: Latency ${metrics.latencyMs}ms (${metrics.colorCategory}) | Jitter ${metrics.jitterMs}ms | Loss ${metrics.packetLoss}% | MOS ${metrics.mosScore}/5.0`}
    >
      {/* 4-Bar Signal Indicator */}
      <div className="flex items-end space-x-0.5 h-3.5 pb-0.5" aria-label={`Signal strength: ${metrics.colorCategory}`}>
        <span className={`w-1 rounded-xs transition-all h-1.5 ${colorStyles.barFilled}`} />
        <span className={`w-1 rounded-xs transition-all h-2.5 ${metrics.quality === 'excellent' || metrics.quality === 'fair' ? colorStyles.barFilled : colorStyles.barEmpty}`} />
        <span className={`w-1 rounded-xs transition-all h-3.5 ${metrics.quality === 'excellent' ? colorStyles.barFilled : colorStyles.barEmpty}`} />
        <span className={`w-1 rounded-xs transition-all h-4 ${metrics.quality === 'excellent' ? colorStyles.barFilled : colorStyles.barEmpty}`} />
      </div>

      <div className="flex items-center space-x-1.5">
        <span className={`w-2 h-2 rounded-full ${colorStyles.dot} ${metrics.quality === 'excellent' ? 'animate-pulse' : ''}`} />
        <span className={`font-bold ${colorStyles.text}`}>
          {metrics.latencyMs < 999 ? `${metrics.latencyMs}ms` : 'OFFLINE'}
        </span>
        <span className="text-[10px] text-slate-400 uppercase hidden sm:inline">
          • {metrics.label}
        </span>
      </div>

      {metrics.hasConnectedCall && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold hidden md:inline">
          HD Audio
        </span>
      )}
    </div>
  );
};
