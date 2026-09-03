import React from 'react';
import { AdjudicationVerdict } from '../types';
import { ShieldCheck, CheckCircle, AlertTriangle, AlertOctagon } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  verdict: AdjudicationVerdict;
  size?: 'xs' | 'sm' | 'md';
}

export const VerdictBadge: React.FC<Props> = ({ verdict, size = 'sm' }) => {
  const { t } = useI18n();
  const iconSize = size === 'xs' ? 11 : size === 'sm' ? 12 : 14;

  const sizeClasses = {
    xs: 'px-1.5 py-0.2 text-[10px] gap-1',
    sm: 'px-2 py-0.5 text-[11px] gap-1.5',
    md: 'px-2.5 py-1 text-xs gap-1.5 font-semibold',
  }[size];

  switch (verdict) {
    case 'official':
      return (
        <span className={`inline-flex items-center rounded border border-[#f5c042]/30 bg-[#f5c042]/10 text-[#f5c042] font-semibold tracking-tight ${sizeClasses}`}>
          <ShieldCheck size={iconSize} className="shrink-0" />
          <span>{t('vOfficial')}</span>
        </span>
      );
    case 'confirmed':
      return (
        <span className={`inline-flex items-center rounded border border-[#45c4b0]/30 bg-[#45c4b0]/10 text-[#45c4b0] dark:text-[#45c4b0] font-semibold tracking-tight ${sizeClasses}`}>
          <CheckCircle size={iconSize} className="shrink-0" />
          <span>{t('vConfirmed')}</span>
        </span>
      );
    case 'suspicious':
      return (
        <span className={`inline-flex items-center rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400 font-semibold tracking-tight ${sizeClasses}`}>
          <AlertTriangle size={iconSize} className="shrink-0" />
          <span>{t('vSuspicious')}</span>
        </span>
      );
    case 'fake':
      return (
        <span className={`inline-flex items-center rounded border border-[#e65138]/30 bg-[#e65138]/10 text-[#e65138] font-semibold tracking-tight ${sizeClasses}`}>
          <AlertOctagon size={iconSize} className="shrink-0" />
          <span>{t('vFake')}</span>
        </span>
      );
    default:
      return null;
  }
};
