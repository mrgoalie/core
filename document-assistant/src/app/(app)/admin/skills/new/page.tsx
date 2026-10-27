"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SkillEditor, type TemplateOption } from "@/components/admin/SkillEditor";
import { useApi } from "@/components/useApi";
import { Alert, PageTitle, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { blankSkillConfig, type SkillConfigInput } from "@/lib/skill-config";

export default function NewSkillPage() {
  const { data } = useApi<{ templates: (TemplateOption & { status: string })[] }>("/api/admin/templates");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const router = useRouter();
  async function create(cfg: SkillConfigInput) {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ skillId: string }>("/api/admin/skills", { body: { config: cfg } });
      router.push(`/admin/skills/${r.skillId}?created=1`);
      return true;
    } catch (e) {
      setError(e as ApiError);
      window.scrollTo({ top: document.body.scrollHeight });
      return false;
    } finally {
      setSaving(false);
    }
  }
  return (
    <div>
      <PageTitle title="Create New Skill" subtitle="Fill in each section, then save. New skills start as a draft that nobody can use until you test, approve, publish and grant access." />
      <Alert tone="info">Tip: you can also copy an existing skill from its page (“Duplicate”) and change it.</Alert>
      <div style={{ marginTop: 20 }}>
        {data ? (
          <SkillEditor initial={blankSkillConfig("New Skill")} templates={data.templates.filter((t) => t.status === "active")} onSave={create} saving={saving} error={error} saveLabel="Create skill (saved as a draft)" />
        ) : (
          <Spinner />
        )}
      </div>
    </div>
  );
}
