'use client'

import React from 'react'

/**
 * @author: @emerald-ui
 * @description: Animated Dropdown Component with smooth transitions and click-outside behavior
 * @version: 1.0.0
 * @date: 2026-02-03
 * @license: MIT
 * @website: https://emerald-ui.com
 */
import { useState, useRef, FC, ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(
      "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      variant === "outline" ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground" :
      variant === "ghost" ? "hover:bg-accent hover:text-accent-foreground" :
      variant === "link" ? "text-primary underline-offset-4 hover:underline" :
      "bg-primary text-primary-foreground hover:bg-primary/90",
      size === "sm" ? "h-9 px-3" : size === "lg" ? "h-11 px-8" : size === "icon" ? "h-10 w-10" : "h-10 px-4 py-2",
      className
    )} {...props} />
  )
);
Button.displayName = "Button";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) handler()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [ref, handler])
}

// Ekstensi lokal: link opsional (kalau tanpa link, item jadi button onSelect),
// description = baris kedua kecil, danger = titik merah, active = centang.
interface DropdownItem {
  name: string
  link?: string
  description?: string
  danger?: boolean
  active?: boolean
}

interface AnimatedDropdownProps {
  items?: DropdownItem[]
  text?: ReactNode
  className?: string
  triggerClassName?: string
  onSelect?: (item: DropdownItem, index: number) => void
}

const DEMO: DropdownItem[] = [
  { name: 'Documentation', link: '#' },
  { name: 'Components', link: '#' },
  { name: 'Examples', link: '#' },
  { name: 'GitHub', link: '#' },
]

export default function AnimatedDropdown({
  items = DEMO,
  text = 'Select Option',
  className,
  triggerClassName,
  onSelect,
}: AnimatedDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <OnClickOutside onClickOutside={() => setIsOpen(false)}>
      <div
        data-state={isOpen ? 'open' : 'closed'}
        className={cn('group relative inline-block', className)}
      >
        <Button
          variant='outline'
          aria-haspopup='listbox'
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className={triggerClassName}
        >
          <span>{text}</span>
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <ChevronDown className='h-5 w-5' />
          </motion.div>
        </Button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              role='listbox'
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{
                duration: 0.2,
                ease: 'easeOut',
              }}
              style={{ maxHeight: 'min(24rem, 60vh)' }}
              className={cn(
                'absolute top-[calc(100%+0.5rem)] left-1/2 z-50 w-fit min-w-full -translate-x-1/2',
                'overflow-y-auto overscroll-contain lab-dropdown-scroll',
                'rounded-md',
                'bg-card',
                'border-2 border-line',
                'shadow-lg'
              )}
            >
              <motion.div
                initial='hidden'
                animate='visible'
                variants={{
                  visible: {
                    transition: {
                      staggerChildren: 0.03,
                    },
                  },
                }}
              >
                {items.map((item, index) => {
                  const content = (
                    <>
                      <span className='flex w-full items-center gap-2'>
                        {item.danger && (
                          <span
                            title='Model sedang gangguan'
                            className='h-1.5 w-1.5 shrink-0 rounded-full bg-red-500'
                          />
                        )}
                        <span className='flex-1 truncate'>{item.name}</span>
                        {item.active && <Check className='h-3.5 w-3.5 shrink-0' />}
                      </span>
                      {item.description && (
                        <span className='mt-0.5 block text-[10px] text-faint'>
                          {item.description}
                        </span>
                      )}
                    </>
                  )
                  const itemClass = cn(
                    'inline-block w-full px-3 py-2 text-sm text-left',
                    'border-b-2 border-line last:border-b-0',
                    'bg-panel hover:bg-accent',
                    'transition-colors duration-150',
                    'text-foreground no-underline',
                    item.active && 'text-gold-ink'
                  )
                  return item.link ? (
                    <motion.a
                      key={index}
                      href={item.link}
                      variants={{
                        hidden: { opacity: 0, x: -20 },
                        visible: { opacity: 1, x: 0 },
                      }}
                      className={itemClass}
                    >
                      {content}
                    </motion.a>
                  ) : (
                    <motion.button
                      key={index}
                      type='button'
                      onClick={() => {
                        onSelect?.(item, index)
                        setIsOpen(false)
                      }}
                      variants={{
                        hidden: { opacity: 0, x: -20 },
                        visible: { opacity: 1, x: 0 },
                      }}
                      className={itemClass}
                    >
                      {content}
                    </motion.button>
                  )
                })}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </OnClickOutside>
  )
}

interface Props {
  children: ReactNode
  onClickOutside: () => void
  classes?: string
}

const OnClickOutside: FC<Props> = ({ children, onClickOutside, classes }) => {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useClickOutside(wrapperRef, onClickOutside)

  return (
    <div ref={wrapperRef} className={cn(classes)}>
      {children}
    </div>
  )
}
