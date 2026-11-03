"use client";

import { Suspense } from "react";
import { LoadingCard } from "../../components/Icons";
import { Wizard } from "../../components/assess/Wizard";

export default function AssessPage() {
  return (
    <Suspense fallback={<main className="page"><LoadingCard /></main>}>
      <Wizard />
    </Suspense>
  );
}
