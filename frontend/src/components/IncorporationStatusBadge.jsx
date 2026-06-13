import React from 'react';
import { CheckCircle2, Loader2, AlertTriangle, Clock } from 'lucide-react';

const STATUS_MAP = {
  pending_payment: {
    label: 'Awaiting payment',
    icon: Clock,
    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    iconCls: 'text-gray-400',
    spin: false,
  },
  paid: {
    label: 'Preparing documents',
    icon: Loader2,
    cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
    iconCls: 'text-blue-500',
    spin: true,
  },
  packet_processing: {
    label: 'Processing packet',
    icon: Loader2,
    cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300',
    iconCls: 'text-blue-500',
    spin: true,
  },
  packet_ready: {
    label: 'Documents ready',
    icon: CheckCircle2,
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    iconCls: 'text-emerald-500',
    spin: false,
  },
  documents_ready: {
    label: 'Documents ready',
    icon: CheckCircle2,
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    iconCls: 'text-emerald-500',
    spin: false,
  },
  failed: {
    label: 'Filing failed',
    icon: AlertTriangle,
    cls: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300',
    iconCls: 'text-red-500',
    spin: false,
  },
};

/**
 * Compact status pill for an incorporation order.
 * Works standalone as a badge; pair with failure-panel copy at the parent level.
 *
 * Props:
 *   status   — one of the known status strings, or null (shows "Checking…")
 *   timedOut — when true, overrides the display to show a "Taking longer than expected" state
 *   size     — 'sm' (default) | 'md'
 */
export default function IncorporationStatusBadge({ status, timedOut = false, size = 'sm' }) {
  const cfg = timedOut
    ? {
        label: 'Taking longer than expected',
        icon: AlertTriangle,
        cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
        iconCls: 'text-amber-500',
        spin: false,
      }
    : status
    ? STATUS_MAP[status] ?? {
        label: status,
        icon: Loader2,
        cls: 'bg-gray-100 text-gray-600',
        iconCls: 'text-gray-400',
        spin: false,
      }
    : {
        label: 'Checking…',
        icon: Loader2,
        cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        iconCls: 'text-gray-400',
        spin: true,
      };

  const Icon = cfg.icon;
  const textSize = size === 'md' ? 'text-xs' : 'text-[11px]';
  const iconSize = size === 'md' ? 13 : 11;
  const padding = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${textSize} ${padding} ${cfg.cls}`}>
      <Icon size={iconSize} className={`${cfg.iconCls}${cfg.spin ? ' animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}
