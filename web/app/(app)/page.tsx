import { getMountain, getReview } from "@/lib/vault/seed";
import { ClimbHero } from "@/components/climb/ClimbHero";
import { Mountain } from "@/components/climb/Mountain";

export default async function ClimbPage() {
  const [stages, review] = await Promise.all([getMountain(), getReview()]);
  const stagesWithWork = stages.filter((s) => s.observationCount > 0).length;
  const openQuestions = stages.reduce((sum, s) => sum + s.questionCount, 0);

  return (
    <div>
      <ClimbHero
        stagesWithWork={stagesWithWork}
        totalStages={stages.length}
        threadCount={review.threads.length}
        openQuestions={openQuestions}
      />
      <Mountain stages={stages} />
    </div>
  );
}
