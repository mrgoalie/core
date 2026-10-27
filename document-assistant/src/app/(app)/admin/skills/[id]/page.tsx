import { Suspense } from "react";
import { SkillAdmin } from "./SkillAdmin";

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SkillAdmin skillId={id} />
    </Suspense>
  );
}
