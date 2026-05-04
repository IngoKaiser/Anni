/**
 * Tool Execution
 *
 * Server-seitige Orchestrierung: Webhook-Aufrufe und MCP-Server-Aufrufe.
 * Demo-User bekommen Mock-Responses, echte User echte API-Calls.
 *
 * Server-side weil:
 * - Webhook-URLs und Auth-Tokens dürfen nie zum Browser
 * - Audit-Log zentral aus einer Quelle
 * - CORS-Probleme vermieden
 */

import type { TenantConfig, TenantTool } from './tenants';

export interface ToolExecutionResult {
  success: boolean;
  spokenResponse: string;
  data?: any;
  error?: string;
}

export async function executeTool(
  tenant: TenantConfig,
  toolId: string,
  args: any,
  userRole: string,
  isDemoUser: boolean
): Promise<ToolExecutionResult> {
  const tool = tenant.tools.find(t => t.id === toolId);
  if (!tool) {
    return { success: false, spokenResponse: 'Tool nicht gefunden.', error: 'Unknown tool' };
  }

  // Rollen-Check
  const allowed = tool.enabled_for_roles.includes('all') || tool.enabled_for_roles.includes(userRole);
  if (!allowed) {
    return {
      success: false,
      spokenResponse: 'Dafür hast du keine Berechtigung.',
      error: 'Permission denied',
    };
  }

  // Demo-User bekommen Mock-Responses
  if (isDemoUser) {
    return getMockResponse(tenant.tenant.id, tool, args);
  }

  // Echte User: dispatch zu Webhook oder MCP
  if (tool.type === 'webhook') {
    return executeWebhook(tool, args);
  }
  if (tool.type === 'mcp') {
    return executeMcpTool(tool, args);
  }

  return { success: false, spokenResponse: 'Tool-Typ unbekannt.', error: 'Unknown tool type' };
}

async function executeWebhook(tool: TenantTool, args: any): Promise<ToolExecutionResult> {
  if (!tool.url) {
    return { success: false, spokenResponse: 'Tool ist nicht konfiguriert.', error: 'No URL' };
  }

  try {
    const response = await fetch(tool.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_id: tool.id,
        arguments: args,
        invoked_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return {
        success: false,
        spokenResponse: 'Das hat leider nicht geklappt.',
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return {
      success: true,
      spokenResponse: data?.spokenResponse || 'Erledigt.',
      data,
    };
  } catch (err: any) {
    return {
      success: false,
      spokenResponse: 'Verbindung zum Tool ist fehlgeschlagen.',
      error: err?.message,
    };
  }
}

async function executeMcpTool(tool: TenantTool, args: any): Promise<ToolExecutionResult> {
  if (!tool.mcp_server) {
    return { success: false, spokenResponse: 'MCP-Server nicht konfiguriert.', error: 'No MCP server' };
  }

  // Vereinfachung: MCP wird als Webhook behandelt (volles MCP-Protokoll Phase 2)
  return executeWebhook({ ...tool, url: tool.mcp_server }, args);
}

/**
 * Realistische Mock-Antworten für Demo-User. Pro Tenant und Tool definiert.
 */
function getMockResponse(tenantId: string, tool: TenantTool, args: any): ToolExecutionResult {
  const mocks: Record<string, Record<string, ToolExecutionResult>> = {
    'pflegeheim-sonnenblick': {
      pms_vitalwerte_speichern: { success: true, spokenResponse: 'Vitalwerte gespeichert. Werte im Normbereich.' },
      pms_beobachtung: { success: true, spokenResponse: 'Beobachtung dokumentiert.' },
      lookup_allergien: { success: true, spokenResponse: 'Erdbeer-Allergie dokumentiert. Sonst keine bekannten Allergien.' },
      lookup_medikation: { success: true, spokenResponse: 'Aktuelle Medikation: Ramipril 5 Milligramm morgens, Metoprolol 47,5 Milligramm abends.' },
      sturzprotokoll: { success: true, spokenResponse: 'Sturzprotokoll angelegt. Schichtleitung wird informiert.' },
      uebergabe_notiz: { success: true, spokenResponse: 'Übergabe-Notiz hinterlegt.' },
      alert_schichtleitung: { success: true, spokenResponse: 'Schichtleitung wurde alarmiert. Sie ist auf dem Weg.' },
      search_hausstandards: {
        success: true,
        spokenResponse: 'Hausstandard: Druckentlastung, hydroaktiver Wundverband, Verbandwechsel alle zwei Tage.',
      },
    },
    'home-care-hamburg': {
      einsatz_dokumentieren: { success: true, spokenResponse: 'Einsatz dokumentiert. Schöner Tag.' },
      kundennotiz: { success: true, spokenResponse: 'Notiz gespeichert.' },
      demenz_tagesstruktur: { success: true, spokenResponse: 'Tagesstruktur erfasst.' },
      angehoerige_info: { success: true, spokenResponse: 'Nachricht ist raus.' },
      lookup_kunde: {
        success: true,
        spokenResponse: 'Frau Hansen, 84 Jahre, mag Spaziergänge an der Alster und gemeinsames Kochen. Tochter heißt Karin.',
      },
      medikation_pruefen: { success: true, spokenResponse: 'Medikation: Marcumar nach Plan, Bisoprolol 2,5 Milligramm morgens.' },
      bereitschaft_kontaktieren: { success: true, spokenResponse: 'Verbinde Sie mit der Bereitschaft im Büro.' },
      notfall_melden: { success: true, spokenResponse: 'Notfall gemeldet. PDL ist informiert.' },
      search_demenz_tipps: {
        success: true,
        spokenResponse: 'Validation: vorstellen, ohne zu korrigieren. Über vertraute Themen sprechen. Ruhig und langsam.',
      },
      naechster_einsatz: {
        success: true,
        spokenResponse: 'Nächster Termin: Herr Brandt, Eppendorfer Landstraße. In 25 Minuten. Geplant: zwei Stunden Gesellschaft.',
      },
    },
    'reha-waldblick': {
      therapie_protokoll: { success: true, spokenResponse: 'Therapie-Einheit dokumentiert.' },
      schmerzskala_erfassen: { success: true, spokenResponse: 'Schmerzwert erfasst.' },
      mobilitaet_assessment: { success: true, spokenResponse: 'Assessment gespeichert.' },
      lookup_therapieplan: {
        success: true,
        spokenResponse: 'Therapieplan: dreimal Physiotherapie, zweimal Ergotherapie, einmal Logopädie pro Woche.',
      },
      lookup_diagnosen: {
        success: true,
        spokenResponse: 'Hauptdiagnose Z96.6, Hüft-TEP rechts. Nebendiagnosen: I10 Hypertonie, E11.9 Diabetes mellitus Typ 2.',
      },
      verordnung_pruefen: { success: true, spokenResponse: 'Verordnung gültig bis Ende des Monats, sechs Einheiten verordnet.' },
      verlaufsbericht: { success: true, spokenResponse: 'Verlaufsbericht generiert und im Portal hinterlegt.' },
      search_leitlinien: {
        success: true,
        spokenResponse: 'Frühmobilisation ab Tag eins, Vollbelastung ab Tag drei, MTT zur Kraftaufbau, Treppensteigen ab zweiter Woche.',
      },
    },
  };

  const tenantMocks = mocks[tenantId] || {};
  return (
    tenantMocks[tool.id] || {
      success: true,
      spokenResponse: `${tool.label} ausgeführt.`,
    }
  );
}
