function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function hhmm(name: string, fallback: string): string {
  const v = optional(name, fallback);
  if (!/^\d{2}:\d{2}$/.test(v)) throw new Error(`${name} deve estar no formato HH:MM`);
  return v;
}

/** Leitura preguiçosa: nada é validado na importação, só quando usado. */
export const config = {
  anthropicModel: () => optional("ANTHROPIC_MODEL", "claude-opus-5-5"),

  whatsapp: () => ({
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    graphVersion: optional("WHATSAPP_GRAPH_VERSION", "v24.0"),
    templateName: optional("WHATSAPP_TEMPLATE_NAME", ""),
    templateLang: optional("WHATSAPP_TEMPLATE_LANG", "pt_BR"),
  }),
  whatsappAppSecret: () => required("WHATSAPP_APP_SECRET"),
  whatsappVerifyToken: () => required("WHATSAPP_VERIFY_TOKEN"),

  ceoName: () => optional("CEO_NAME", "o CEO"),
  ceoWhatsapp: () => required("CEO_WHATSAPP"),
  companyName: () => optional("COMPANY_NAME", "a empresa"),

  microsoft: () => ({
    tenantId: required("MS_TENANT_ID"),
    clientId: required("MS_CLIENT_ID"),
    clientSecret: required("MS_CLIENT_SECRET"),
    calendarUser: required("MS_CALENDAR_USER"),
  }),

  supabase: () => ({
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  }),

  cronSecret: () => required("CRON_SECRET"),

  timezone: () => optional("TIMEZONE", "America/Sao_Paulo"),
  workStart: () => hhmm("WORK_START", "09:00"),
  workEnd: () => hhmm("WORK_END", "18:00"),
  workDays: () =>
    optional("WORK_DAYS", "1,2,3,4,5")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  reminderLeads: () =>
    optional("REMINDER_LEAD_MINUTES", "60,15")
      .split(",")
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isFinite(d) && d > 0),
  briefingTime: () => hhmm("BRIEFING_TIME", "07:30"),
  newsDigestTime: () => {
    const v = process.env.NEWS_DIGEST_TIME;
    if (v === "") return null;
    return hhmm("NEWS_DIGEST_TIME", "18:00");
  },
  newsFocus: () => optional("NEWS_FOCUS", ""),
  clientMinNoticeHours: () => Number(optional("CLIENT_MIN_NOTICE_HOURS", "4")),
  allowUnknownContacts: () => optional("ALLOW_UNKNOWN_CONTACTS", "true") !== "false",
};
