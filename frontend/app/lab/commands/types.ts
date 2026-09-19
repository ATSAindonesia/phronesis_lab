// Tipe data Command Sets — mirror dari JSON backend Go (internal/commands).

export interface Service {
  uuid: string;
  user_uuid: string;
  name: string;
  description: string;
  title_count: number;
  command_count: number;
  created_at: string;
  updated_at: string;
}

export interface CommandTitle {
  uuid: string;
  service_uuid: string;
  title: string;
  description: string;
  command_count: number;
  created_at: string;
  updated_at: string;
}

export interface BashCommand {
  uuid: string;
  title_uuid: string;
  label: string;
  body: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceDetail {
  service: Service;
  titles: CommandTitle[];
}

export interface TitleDetail {
  title: CommandTitle;
  commands: BashCommand[];
}
