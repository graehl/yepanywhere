import { fetchJSON } from "./sourceApiFetch";

export const onboardingApi = {
  getOnboardingStatus: () => fetchJSON<{ complete: boolean }>("/onboarding"),

  completeOnboarding: () =>
    fetchJSON<{ success: boolean }>("/onboarding/complete", {
      method: "POST",
    }),

  resetOnboarding: () =>
    fetchJSON<{ success: boolean }>("/onboarding/reset", {
      method: "POST",
    }),
};
