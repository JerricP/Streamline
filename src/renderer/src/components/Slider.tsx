import { Slider as BaseSlider } from '@base-ui/react/slider'

/** A 0–100 percentage slider (base-ui Slider), labelled by the element with `labelId`. */
export function Slider({
  value,
  onChange,
  labelId
}: {
  value: number
  onChange: (next: number) => void
  labelId: string
}) {
  return (
    <BaseSlider.Root
      className="slider"
      min={0}
      max={100}
      value={value}
      onValueChange={(next) => onChange(next as number)}
      aria-labelledby={labelId}
    >
      <BaseSlider.Control className="slider__control">
        <BaseSlider.Track className="slider__track">
          <BaseSlider.Indicator className="slider__fill" />
          <BaseSlider.Thumb className="slider__thumb" aria-labelledby={labelId} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
