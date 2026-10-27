import { Suspense } from "react";
import { HomeScreen } from "./HomeScreen";

export default function Page() {
  return (
    <Suspense>
      <HomeScreen />
    </Suspense>
  );
}
