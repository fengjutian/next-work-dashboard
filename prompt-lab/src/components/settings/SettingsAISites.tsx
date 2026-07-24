import React from 'react';
import { Plus } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SiteRow } from '@/components/SiteRow';
import { useStore } from '@/store';
import type { SiteConfig } from '@/store';

// ── AI 站点管理 Tab ──

export const SettingsAISites: React.FC = () => {
  const sites = useStore((s) => s.sites);

  const handleSiteUpdate = (id: string, patch: Partial<SiteConfig>) => {
    useStore.getState().updateSite(id, patch);
  };

  const handleDeleteSite = (id: string) => {
    const s = useStore.getState();
    if (id.startsWith('custom-')) {
      useStore.setState({ sites: s.sites.filter((si) => si.id !== id) });
    } else {
      s.updateSite(id, { enabled: false });
    }
  };

  const handleAddSite = () => {
    const s = useStore.getState();
    useStore.getState().addSite({
      id: `custom-${Date.now()}`,
      name: '新站点',
      url: 'https://',
      inputSelector: 'textarea',
      submitSelector: '',
      enabled: true,
      sortOrder: s.sites.length,
    });
  };

  const allSites = [...sites].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
          AI 站点
        </h4>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs gap-1 px-2"
          onClick={handleAddSite}
        >
          <Plus className="h-3 w-3" /> 添加
        </Button>
      </div>
      <div className="space-y-2">
        {allSites.map((site) => (
          <SiteRow
            key={site.id}
            site={site}
            onUpdate={(patch) => handleSiteUpdate(site.id, patch)}
            onDelete={() => handleDeleteSite(site.id)}
          />
        ))}
      </div>
    </section>
  );
};
