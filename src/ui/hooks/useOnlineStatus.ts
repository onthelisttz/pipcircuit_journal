import { useEffect, useState } from "react";
import { isOnline as checkOnline, onConnectionChange } from "@infrastructure/sync/utils/connection";

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(checkOnline());

  useEffect(() => {
    return onConnectionChange((online) => setIsOnline(online));
  }, []);

  return isOnline;
}
