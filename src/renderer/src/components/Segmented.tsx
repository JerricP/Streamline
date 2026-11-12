import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import clsx from 'clsx'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

/** One choice from a few, with arrow-key movement between options (base-ui ToggleGroup). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  wrap
}: {
  value: T
  options: Array<SegmentedOption<T>>
  onChange: (next: T) => void
  label: string
  wrap?: boolean
}) {
  return (
    <ToggleGroup
      aria-label={label}
      className={clsx('segmented', wrap && 'segmented--wrap')}
      value={[value]}
      // A segmented control always keeps one option chosen, so ignore the "unpress" event.
      onValueChange={(next) => {
        if (next[0] !== undefined) onChange(next[0] as T)
      }}
    >
      {options.map((option) => (
        <Toggle key={option.value} value={option.value} disabled={option.disabled} className="segmented__item">
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
