import { Switch } from '@base-ui/react/switch'

export function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={(next) => onChange(next)}
      aria-label={label}
      disabled={disabled}
      className="toggle"
    >
      <Switch.Thumb className="toggle__knob" />
    </Switch.Root>
  )
}
