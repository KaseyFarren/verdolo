'use client'

import Tooltip from './Tooltip'
import { InfoIcon } from './icons'

export default function InfoTooltip({ content }: { content: string }) {
  return (
    <Tooltip content={content}>
      <span className="ml-1 inline-flex text-sage/60 hover:text-sage cursor-help align-middle">
        <InfoIcon />
      </span>
    </Tooltip>
  )
}
