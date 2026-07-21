import { useHostIdentity } from "../contexts/HostIdentityContext";
import { useI18n } from "../i18n";

export function HostIdentityMarker() {
  const { icon } = useHostIdentity();
  const { t } = useI18n();
  if (!icon) return null;

  const label = t("hostIdentityMarkerAria", { icon });
  return (
    <span
      className="host-identity-marker"
      role="img"
      aria-label={label}
      title={label}
    >
      {icon}
    </span>
  );
}
