import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import type { Index, Sym } from './types'
import type { Link } from './url'

export interface Nav {
  href(link: Partial<Link>): string
  go(link: Partial<Link>): void
}

export const NavContext = createContext<Nav>({ href: () => '#', go: () => {} })
export const useNav = () => useContext(NavContext)

/** "path:line:col" of a symbol's definition: how links name a symbol. */
export const placeOf = (index: Index, s: Sym) => `${index.files[s.def.file].path}:${s.def.line}:${s.def.col}`
export const toFunction = (index: Index, s: Sym): Partial<Link> => ({ view: 'function', fn: placeOf(index, s) })
export const toThreads = (index: Index, s: Sym): Partial<Link> => ({ view: 'threads', files: [index.files[s.def.file].path], sym: placeOf(index, s) })

/** A link inside the app: a real href, so it opens in a new tab when asked to, and no page load otherwise. */
export function Go({ to, children, ...rest }: { to: Partial<Link>; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const nav = useNav()
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    nav.go(to)
  }
  return (
    <a {...rest} href={nav.href(to)} onClick={click}>
      {children}
    </a>
  )
}
