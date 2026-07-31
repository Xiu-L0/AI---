import { ManualCapturePage } from "@/features/capture/components/manual-capture-page";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewCapturePage({
  searchParams,
}: {
  searchParams: Promise<{ recoveryCaptureId?: string | string[] }>;
}) {
  const requested = (await searchParams).recoveryCaptureId;
  const recoveryCaptureId =
    typeof requested === "string" && UUID_PATTERN.test(requested)
      ? requested
      : undefined;

  return (
    <ManualCapturePage
      {...(recoveryCaptureId === undefined ? {} : { recoveryCaptureId })}
    />
  );
}
