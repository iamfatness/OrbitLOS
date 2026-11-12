import { propertyStateCodes, propertyStateName } from "@/lib/property-state";

export function PropertyStateOptions({ placeholder = "Select a state" }: { placeholder?: string }) {
  return <>
    <option value="">{placeholder}</option>
    {propertyStateCodes.map(code => <option key={code} value={code}>{code} · {propertyStateName(code)}</option>)}
  </>;
}

export function OptionalPropertyState({ disabled }: { disabled: boolean }) {
  return <label className="field">Property state (optional)
    <select name="propertyState" defaultValue="" disabled={disabled}>
      <PropertyStateOptions placeholder="Unknown or undecided" />
    </select>
  </label>;
}
