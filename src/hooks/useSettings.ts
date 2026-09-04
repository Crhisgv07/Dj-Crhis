import { useEffect, useState } from "react";
import { settings } from "../settings/store";

export function useSettings() {
  const [value, setValue] = useState(() => settings.get());
  useEffect(() => settings.subscribe(setValue), []);
  return value;
}
