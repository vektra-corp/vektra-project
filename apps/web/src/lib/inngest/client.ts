import { EventSchemas, Inngest } from 'inngest'

/**
 * Inngest client (§3: durable execution for imports, exports, workflows, digests).
 *
 * Typed events mean a `send` with the wrong payload shape is a build error
 * rather than a job that fails at 3am.
 */
// Must be a type alias, not an interface: Inngest's `fromRecord` constraint
// requires an implicit index signature, which an interface does not provide.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Events = {
  'notification/created': {
    data: { notification_id: string; organization_id: string; user_id: string }
  }
  'org/digest.requested': {
    data: { organization_id: string; user_id: string }
  }
}

export const inngest = new Inngest({
  id: 'project-management',
  schemas: new EventSchemas().fromRecord<Events>(),
  eventKey: process.env.INNGEST_EVENT_KEY,
})
