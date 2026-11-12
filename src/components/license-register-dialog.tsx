"use client";

import { useEffect, useId, useRef } from "react";
import type { LicenseRegisterScope } from "@/lib/compliance-program-model";
import { ComplianceLicensing } from "./compliance-licensing";
import { Button } from "./ui/button";

export function LicenseRegisterDialog({ brokerageId, paused, scope, onBack, onLicenseSaved }: {
  brokerageId: string; paused: boolean; scope: LicenseRegisterScope; onBack: () => void; onLicenseSaved?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    title.current?.focus();
    return () => element.close();
  }, []);

  return <dialog ref={dialog} className="record-dialog record-dialog-wide license-register-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onBack(); }}>
    <div className="dialog-top">
      <div className="dialog-head">
        <h2 ref={title} id={titleId} tabIndex={-1}>License register</h2>
        <Button variant="ghost" onClick={onBack}>Back to lead</Button>
      </div>
    </div>
    <div className="dialog-content">
      <ComplianceLicensing brokerageId={brokerageId} paused={paused} reviewScope={scope} onLicenseSaved={onLicenseSaved} />
    </div>
  </dialog>;
}
