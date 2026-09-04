'use client'

import { COMMERCIAL_STATUSES, type CommercialDocType } from '@pm/shared/constants'
import { formatCurrency } from '@pm/shared/utils'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  toast,
} from '@pm/ui'
import { ArrowRightLeft, ChevronDown, MoreHorizontal, Trash2, Wallet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  convertQuotationToInvoice,
  deleteCommercialDoc,
  recordPayment,
  setCommercialStatus,
} from './actions'

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

/** Status, payment, conversion and delete — everything that acts on a document. */
export function DocumentActions({
  scope,
  documentId,
  docType,
  docSegment,
  status,
  grandTotal,
  amountPaid,
  currency,
  locale,
  isConverted,
  canDelete,
}: {
  scope: Scope
  documentId: string
  docType: CommercialDocType
  docSegment: string
  status: string
  grandTotal: number
  amountPaid: number
  currency: string
  locale: string
  isConverted: boolean
  canDelete: boolean
}) {
  const [payOpen, setPayOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const outstanding = grandTotal - amountPaid
  const takesPayment =
    (docType === 'invoice' || docType === 'bill') && outstanding > 0 && status !== 'void'
  const canConvert = docType === 'quotation' && status === 'accepted' && !isConverted
  const isDraft = status === 'draft' || status === 'received'

  function changeStatus(next: string) {
    startTransition(async () => {
      const result = await setCommercialStatus(scope, documentId, next)
      if (result.ok) {
        toast({ title: `Marked ${next.replace('_', ' ')}` })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not update', description: result.message })
      }
    })
  }

  function pay() {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return

    startTransition(async () => {
      const result = await recordPayment(scope, documentId, value)
      if (result.ok) {
        setPayOpen(false)
        setAmount('')
        toast({ title: 'Payment recorded' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not record', description: result.message })
      }
    })
  }

  function convert() {
    startTransition(async () => {
      const result = await convertQuotationToInvoice(scope, documentId)
      if (result.ok) {
        toast({ title: 'Invoice created', description: 'Opened as a draft.' })
        router.push(
          `/${scope.orgSlug}/${scope.workspaceSlug}/commercial/invoices/${result.data.id}`,
        )
      } else {
        toast({ variant: 'destructive', title: 'Could not convert', description: result.message })
      }
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteCommercialDoc(scope, documentId)
      if (result.ok) {
        toast({ title: 'Draft deleted' })
        router.push(`/${scope.orgSlug}/${scope.workspaceSlug}/commercial/${docSegment}`)
      } else {
        toast({ variant: 'destructive', title: 'Could not delete', description: result.message })
      }
    })
  }

  return (
    <>
      {canConvert ? (
        <Button size="sm" loading={pending} onClick={convert}>
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
          Convert to invoice
        </Button>
      ) : null}

      {takesPayment ? (
        <Button variant="subtle" size="sm" onClick={() => setPayOpen(true)}>
          <Wallet className="h-3.5 w-3.5" aria-hidden />
          Record payment
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="subtle" size="sm" className="gap-1.5" disabled={pending}>
            Status
            <ChevronDown className="h-3 w-3 text-faint" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={status} onValueChange={changeStatus}>
            {(COMMERCIAL_STATUSES[docType] as readonly string[]).map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className="capitalize">
                {option.replace('_', ' ')}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {canDelete && isDraft ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 aria-hidden />
              Delete draft
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {formatCurrency(outstanding, currency, locale)} outstanding of{' '}
              {formatCurrency(grandTotal, currency, locale)}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="payment-amount" className="text-sm font-medium">
              Amount
            </label>
            <Input
              id="payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              max={outstanding}
              value={amount}
              autoFocus
              onChange={(event) => setAmount(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  pay()
                }
              }}
            />
            <button
              type="button"
              className="label-meta text-faint transition-colors hover:text-muted-foreground"
              onClick={() => setAmount(String(outstanding))}
            >
              Pay in full
            </button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={pay} disabled={!amount}>
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              Its number is not reused, so the sequence will show a gap. Only a draft can be
              deleted — anything issued is voided instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={pending} onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
