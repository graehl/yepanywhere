import { useCallback, useEffect, useState } from "react";
import {
  getBrowserXaiSttApiKey,
  setBrowserXaiSttApiKey as saveBrowserXaiSttApiKey,
  subscribeBrowserXaiSttApiKey,
} from "../lib/speechProviders/xaiCredentials";

export function useBrowserXaiSttApiKey() {
  const [browserXaiSttApiKey, setBrowserXaiSttApiKeyState] = useState(
    getBrowserXaiSttApiKey,
  );

  useEffect(() => {
    return subscribeBrowserXaiSttApiKey(() => {
      setBrowserXaiSttApiKeyState(getBrowserXaiSttApiKey());
    });
  }, []);

  const setBrowserXaiSttApiKey = useCallback((apiKey: string) => {
    setBrowserXaiSttApiKeyState(apiKey);
    saveBrowserXaiSttApiKey(apiKey);
  }, []);

  return {
    browserXaiSttApiKey,
    hasBrowserXaiSttApiKey: browserXaiSttApiKey.trim().length > 0,
    setBrowserXaiSttApiKey,
  };
}
