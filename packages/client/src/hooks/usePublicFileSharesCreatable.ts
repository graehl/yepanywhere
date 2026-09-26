import {
  PUBLIC_FILE_SHARES_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { usePublicShareStatus } from "./usePublicShareStatus";
import { useRetainedVersionInfo } from "./useVersion";

/**
 * Whether an authenticated view may offer to copy or mint a public file share
 * link now: public shares can be created and the server supports file shares.
 * Call it only where such an action is about to be shown, since it reads the
 * authenticated public-share status.
 */
export function usePublicFileSharesCreatable(): boolean {
  const publicShare = usePublicShareContext();
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const { status } = usePublicShareStatus();
  return (
    publicShare === null &&
    status?.canCreate === true &&
    serverHasCapability(version, PUBLIC_FILE_SHARES_CAPABILITY)
  );
}
