import { BookOpen, Briefcase, Calculator, CalendarClock, Car, ClipboardList, Files, FileText, FolderOpen, Gavel, HeartPulse, Landmark, Mail, PenLine, Receipt, Scale, ShieldCheck, Stamp, type LucideIcon } from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  "file-text": FileText,
  mail: Mail,
  scale: Scale,
  gavel: Gavel,
  files: Files,
  "clipboard-list": ClipboardList,
  calculator: Calculator,
  receipt: Receipt,
  "folder-open": FolderOpen,
  briefcase: Briefcase,
  "heart-pulse": HeartPulse,
  car: Car,
  "shield-check": ShieldCheck,
  stamp: Stamp,
  "pen-line": PenLine,
  "book-open": BookOpen,
  landmark: Landmark,
  "calendar-clock": CalendarClock,
};

export function SkillIcon({ name, size = 30 }: { name: string; size?: number }) {
  const Icon = MAP[name] ?? FileText;
  return <Icon size={size} aria-hidden="true" strokeWidth={1.8} />;
}
