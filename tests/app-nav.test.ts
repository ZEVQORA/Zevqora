/**
 * Chat-first navigation (founder UX correction 2026-11-13): Ask Zev is the
 * first primary item, then Overview, the work and the workspace. Every route
 * that existed before is still reachable (sidebar or More, and the command
 * palette reads the same list) and flags still hide gated items.
 */
import { describe, expect, it } from 'vitest';
import { NAV, NAV_GROUPS, navSections } from '../src/app/AppShell';

const BEFORE = ['/app', '/app/command', '/app/workloads', '/app/graph', '/app/diagnoses', '/app/optimize', '/app/experiments', '/app/evidence', '/app/changes', '/app/value', '/app/connections', '/app/team', '/app/settings', '/app/enterprise', '/app/project', '/app/opportunities', '/app/evaluation', '/app/savings', '/app/zev', '/app/usage', '/app/docs', '/download'];

describe('app navigation', () => {
  it('keeps every existing route; Ask Zev is the home and the dashboard is Overview', () => {
    expect(NAV.map((n) => n.to).sort()).toEqual([...BEFORE].sort());
    expect(NAV[0]).toMatchObject({ to: '/app', label: 'Ask Zev', end: true });
    expect(NAV.find((n) => n.to === '/app/command')?.label).toBe('Overview');
  });

  it('puts the primary actions first and the rest under More', () => {
    expect(NAV_GROUPS).toEqual(['Home', 'Work', 'Workspace']);
    const { groups: base } = navSections({});
    expect(base.flatMap(([, items]) => items.map((i) => i.label))).toEqual(['Ask Zev', 'Overview', 'Workloads', 'Evidence', 'Connections', 'Team', 'Settings']);
    for (const n of NAV) expect(Boolean(n.group) !== Boolean(n.more)).toBe(true);
    const { groups, more } = navSections({ zevir_graph_ui: true, verified_optimization_vnext: true });
    expect(groups.map(([g]) => g)).toEqual(NAV_GROUPS);
    const primary = groups.flatMap(([, items]) => items.map((i) => i.to));
    expect(primary.length).toBeLessThanOrEqual(11);
    expect(primary.length + more.length).toBe(NAV.length);
  });

  it('still hides flagged items for workspaces without the flag', () => {
    const { groups } = navSections({});
    const primary = groups.flatMap(([, items]) => items.map((i) => i.to));
    expect(primary).not.toContain('/app/graph');
    expect(primary).not.toContain('/app/optimize');
    expect(primary).toContain('/app/workloads');
  });
});
