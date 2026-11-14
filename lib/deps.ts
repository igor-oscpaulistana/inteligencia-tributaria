import { config } from "./config";
import { typedPhoneKey } from "./phone";
import { OutlookCalendar } from "./graph";
import { getStore } from "./store";
import type { Settings } from "./agent/context";
import type { Calendar, Messenger, Store } from "./types";
import { WhatsAppMessenger } from "./whatsapp";

export interface Deps {
  store: Store;
  calendar: Calendar;
  messenger: Messenger;
  settings: Settings;
}

export function loadSettings(): Settings {
  return {
    tz: config.timezone(),
    workStart: config.workStart(),
    workEnd: config.workEnd(),
    workDays: config.workDays(),
    clientMinNoticeHours: config.clientMinNoticeHours(),
    ceoName: config.ceoName(),
    companyName: config.companyName(),
    ceoPhoneKey: typedPhoneKey(config.ceoWhatsapp()),
  };
}

export function productionDeps(): Deps {
  const store = getStore();
  const settings = loadSettings();
  return {
    store,
    settings,
    calendar: new OutlookCalendar(settings.tz),
    messenger: new WhatsAppMessenger(store),
  };
}
