/**
 * Tenant Loading & Resolution
 * Liest YAML-Konfigurationen aus /tenants/, validiert, mapt Email auf Tenant.
 */

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface TenantToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
}

export interface TenantTool {
  id: string;
  label: string;
  description: string;
  type: 'webhook' | 'mcp';
  url?: string;
  mcp_server?: string;
  enabled_for_roles: string[];
  require_confirmation?: boolean;
  parameters?: TenantToolParameter[];
}

export interface TenantConfig {
  tenant: {
    id: string;
    name: string;
    industry: string;
    email_domains: string[];
    default_language: string;
    auth_mode?: string;
  };
  branding: {
    app_name: string;
    primary_color: string;
    secondary_color: string;
    logo_emoji: string;
    greeting: string;
    tagline?: string;
  };
  agent: {
    voice_id: string;
    persona: string;
  };
  tools: TenantTool[];
  roles: Array<{ id: string; label: string; description: string }>;
  compliance: {
    data_residency: string;
    audit_retention_days: number;
    [key: string]: any;
  };
  region?: { city: string; [key: string]: any };
}

let cachedTenants: TenantConfig[] | null = null;

export function loadAllTenants(): TenantConfig[] {
  if (cachedTenants) return cachedTenants;

  const tenantsDir = path.join(process.cwd(), 'tenants');
  const files = readdirSync(tenantsDir).filter(f => f.endsWith('.yaml'));

  const tenants: TenantConfig[] = files.map(file => {
    const content = readFileSync(path.join(tenantsDir, file), 'utf-8');
    return yaml.load(content) as TenantConfig;
  });

  cachedTenants = tenants;
  return tenants;
}

export function resolveTenantByEmail(email: string): TenantConfig | null {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;

  const tenants = loadAllTenants();
  return tenants.find(t => t.tenant.email_domains.includes(domain)) || null;
}

export function getTenantById(id: string): TenantConfig | null {
  const tenants = loadAllTenants();
  return tenants.find(t => t.tenant.id === id) || null;
}

export function getAllTenants(): TenantConfig[] {
  return loadAllTenants();
}

/**
 * Liefert eine "öffentliche" Sicht des Tenants - ohne Webhook-URLs und Auth-Secrets.
 * Diese Version geht zum Frontend.
 */
export function tenantToPublicView(tenant: TenantConfig) {
  return {
    id: tenant.tenant.id,
    name: tenant.tenant.name,
    industry: tenant.tenant.industry,
    email_domains: tenant.tenant.email_domains,
    default_language: tenant.tenant.default_language,
    branding: tenant.branding,
    agent: { persona: tenant.agent.persona, voice_id: tenant.agent.voice_id },
    tools: tenant.tools.map(t => ({
      id: t.id,
      label: t.label,
      description: t.description,
      type: t.type,
      enabled_for_roles: t.enabled_for_roles,
      require_confirmation: t.require_confirmation,
    })),
    roles: tenant.roles,
    compliance: {
      data_residency: tenant.compliance.data_residency,
      audit_retention_days: tenant.compliance.audit_retention_days,
    },
    region: tenant.region,
  };
}

export type PublicTenantConfig = ReturnType<typeof tenantToPublicView>;
