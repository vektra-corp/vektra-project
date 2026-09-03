// AUTO-GENERATED — do not edit by hand.
//
// Regenerate with either:
//   pnpm db:types           (supabase CLI, requires Docker)
//   pnpm db:types:offline   (scripts/gen-types.mjs, any Postgres URL)

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      admin_impersonations: {
        Row: {
          id: string
          admin_user_id: string
          organization_id: string
          target_user_id: string | null
          reason: string
          ticket_ref: string | null
          started_at: string
          ended_at: string | null
        }
        Insert: {
          id?: string
          admin_user_id: string
          organization_id: string
          target_user_id?: string | null
          reason: string
          ticket_ref?: string | null
          started_at?: string
          ended_at?: string | null
        }
        Update: {
          id?: string
          admin_user_id?: string
          organization_id?: string
          target_user_id?: string | null
          reason?: string
          ticket_ref?: string | null
          started_at?: string
          ended_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'admin_impersonations_admin_user_id_fkey'
            columns: ['admin_user_id']
            isOneToOne: false
            referencedRelation: 'admin_users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'admin_impersonations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'admin_impersonations_target_user_id_fkey'
            columns: ['target_user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      admin_users: {
        Row: {
          id: string
          user_id: string | null
          email: string
          full_name: string
          role: string
          is_active: boolean
          last_login_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          email: string
          full_name: string
          role?: string
          is_active?: boolean
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          email?: string
          full_name?: string
          role?: string
          is_active?: boolean
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'admin_users_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      announcement_dismissals: {
        Row: {
          announcement_id: string
          user_id: string
          dismissed_at: string
        }
        Insert: {
          announcement_id: string
          user_id: string
          dismissed_at?: string
        }
        Update: {
          announcement_id?: string
          user_id?: string
          dismissed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'announcement_dismissals_announcement_id_fkey'
            columns: ['announcement_id']
            isOneToOne: false
            referencedRelation: 'announcements'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'announcement_dismissals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      announcements: {
        Row: {
          id: string
          title: string
          body: string
          display_type: string
          target: Json
          cta_text: string | null
          cta_url: string | null
          is_active: boolean
          starts_at: string
          ends_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          body: string
          display_type: string
          target?: Json
          cta_text?: string | null
          cta_url?: string | null
          is_active?: boolean
          starts_at?: string
          ends_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          body?: string
          display_type?: string
          target?: Json
          cta_text?: string | null
          cta_url?: string | null
          is_active?: boolean
          starts_at?: string
          ends_at?: string | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      approval_chains: {
        Row: {
          id: string
          organization_id: string
          doc_type: string
          name: string
          conditions: Json
          steps: Json
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          doc_type: string
          name: string
          conditions?: Json
          steps: Json
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          doc_type?: string
          name?: string
          conditions?: Json
          steps?: Json
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'approval_chains_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      approval_steps: {
        Row: {
          id: string
          organization_id: string
          document_id: string
          chain_id: string | null
          step_index: number
          required_role: string
          status: string
          decided_by: string | null
          decided_at: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          document_id: string
          chain_id?: string | null
          step_index: number
          required_role: string
          status?: string
          decided_by?: string | null
          decided_at?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          document_id?: string
          chain_id?: string | null
          step_index?: number
          required_role?: string
          status?: string
          decided_by?: string | null
          decided_at?: string | null
          note?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'approval_steps_chain_id_fkey'
            columns: ['chain_id']
            isOneToOne: false
            referencedRelation: 'approval_chains'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'approval_steps_decided_by_fkey'
            columns: ['decided_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'approval_steps_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'commercial_documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'approval_steps_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      attachments: {
        Row: {
          id: string
          organization_id: string
          task_id: string | null
          subtask_id: string | null
          comment_id: string | null
          document_id: string | null
          file_name: string
          file_size: number
          mime_type: string
          storage_path: string
          uploaded_by: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          task_id?: string | null
          subtask_id?: string | null
          comment_id?: string | null
          document_id?: string | null
          file_name: string
          file_size: number
          mime_type: string
          storage_path: string
          uploaded_by: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          task_id?: string | null
          subtask_id?: string | null
          comment_id?: string | null
          document_id?: string | null
          file_name?: string
          file_size?: number
          mime_type?: string
          storage_path?: string
          uploaded_by?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'attachments_comment_id_fkey'
            columns: ['comment_id']
            isOneToOne: false
            referencedRelation: 'comments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attachments_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attachments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attachments_subtask_id_fkey'
            columns: ['subtask_id']
            isOneToOne: false
            referencedRelation: 'subtasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attachments_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          id: string
          organization_id: string
          actor_id: string | null
          actor_type: string
          action: string
          resource_type: string
          resource_id: string | null
          changes: Json | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          actor_id?: string | null
          actor_type?: string
          action: string
          resource_type: string
          resource_id?: string | null
          changes?: Json | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          actor_id?: string | null
          actor_type?: string
          action?: string
          resource_type?: string
          resource_id?: string | null
          changes?: Json | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'audit_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      branches: {
        Row: {
          id: string
          organization_id: string
          name: string
          location: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          location?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          location?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'branches_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      comments: {
        Row: {
          id: string
          organization_id: string
          task_id: string | null
          subtask_id: string | null
          document_id: string | null
          parent_id: string | null
          author_id: string
          body: Json
          is_internal: boolean
          is_edited: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          task_id?: string | null
          subtask_id?: string | null
          document_id?: string | null
          parent_id?: string | null
          author_id: string
          body: Json
          is_internal?: boolean
          is_edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          task_id?: string | null
          subtask_id?: string | null
          document_id?: string | null
          parent_id?: string | null
          author_id?: string
          body?: Json
          is_internal?: boolean
          is_edited?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'comments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_subtask_id_fkey'
            columns: ['subtask_id']
            isOneToOne: false
            referencedRelation: 'subtasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
        ]
      }
      commercial_doc_sequences: {
        Row: {
          id: string
          organization_id: string
          doc_type: string
          prefix: string
          reset_period: string
          period_key: string
          padding: number
          last_number: number
        }
        Insert: {
          id?: string
          organization_id: string
          doc_type: string
          prefix: string
          reset_period?: string
          period_key?: string
          padding?: number
          last_number?: number
        }
        Update: {
          id?: string
          organization_id?: string
          doc_type?: string
          prefix?: string
          reset_period?: string
          period_key?: string
          padding?: number
          last_number?: number
        }
        Relationships: [
          {
            foreignKeyName: 'commercial_doc_sequences_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      commercial_documents: {
        Row: {
          id: string
          organization_id: string
          workspace_id: string
          project_id: string | null
          doc_type: string
          doc_number: string
          contact_id: string | null
          status: string
          issue_date: string
          due_date: string | null
          valid_until: string | null
          currency: string
          subtotal: number
          tax_total: number
          discount_total: number
          grand_total: number
          amount_paid: number
          notes: string | null
          terms: string | null
          pdf_template_id: string | null
          reference_doc_id: string | null
          converted_to_id: string | null
          metadata: Json
          approved_by: string | null
          approved_at: string | null
          sent_at: string | null
          viewed_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          workspace_id: string
          project_id?: string | null
          doc_type: string
          doc_number: string
          contact_id?: string | null
          status?: string
          issue_date?: string
          due_date?: string | null
          valid_until?: string | null
          currency?: string
          subtotal?: number
          tax_total?: number
          discount_total?: number
          grand_total?: number
          amount_paid?: number
          notes?: string | null
          terms?: string | null
          pdf_template_id?: string | null
          reference_doc_id?: string | null
          converted_to_id?: string | null
          metadata?: Json
          approved_by?: string | null
          approved_at?: string | null
          sent_at?: string | null
          viewed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          workspace_id?: string
          project_id?: string | null
          doc_type?: string
          doc_number?: string
          contact_id?: string | null
          status?: string
          issue_date?: string
          due_date?: string | null
          valid_until?: string | null
          currency?: string
          subtotal?: number
          tax_total?: number
          discount_total?: number
          grand_total?: number
          amount_paid?: number
          notes?: string | null
          terms?: string | null
          pdf_template_id?: string | null
          reference_doc_id?: string | null
          converted_to_id?: string | null
          metadata?: Json
          approved_by?: string | null
          approved_at?: string | null
          sent_at?: string | null
          viewed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'commercial_documents_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_contact_id_fkey'
            columns: ['contact_id']
            isOneToOne: false
            referencedRelation: 'contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_converted_to_id_fkey'
            columns: ['converted_to_id']
            isOneToOne: false
            referencedRelation: 'commercial_documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_pdf_template_id_fkey'
            columns: ['pdf_template_id']
            isOneToOne: false
            referencedRelation: 'pdf_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_reference_doc_id_fkey'
            columns: ['reference_doc_id']
            isOneToOne: false
            referencedRelation: 'commercial_documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_documents_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      commercial_line_items: {
        Row: {
          id: string
          document_id: string
          organization_id: string
          description: string
          quantity: number
          unit_price: number
          tax_rate: number
          discount: number
          line_total: number
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          document_id: string
          organization_id: string
          description: string
          quantity?: number
          unit_price: number
          tax_rate?: number
          discount?: number
          line_total: number
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          organization_id?: string
          description?: string
          quantity?: number
          unit_price?: number
          tax_rate?: number
          discount?: number
          line_total?: number
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'commercial_line_items_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'commercial_documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'commercial_line_items_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      contacts: {
        Row: {
          id: string
          organization_id: string
          type: string
          company_name: string | null
          contact_name: string
          email: string | null
          phone: string | null
          address: Json | null
          tax_id: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          type: string
          company_name?: string | null
          contact_name: string
          email?: string | null
          phone?: string | null
          address?: Json | null
          tax_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          type?: string
          company_name?: string | null
          contact_name?: string
          email?: string | null
          phone?: string | null
          address?: Json | null
          tax_id?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'contacts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'contacts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      custom_field_values: {
        Row: {
          id: string
          custom_field_id: string
          organization_id: string
          entity_id: string
          value: Json
        }
        Insert: {
          id?: string
          custom_field_id: string
          organization_id: string
          entity_id: string
          value: Json
        }
        Update: {
          id?: string
          custom_field_id?: string
          organization_id?: string
          entity_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'custom_field_values_custom_field_id_fkey'
            columns: ['custom_field_id']
            isOneToOne: false
            referencedRelation: 'custom_fields'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'custom_field_values_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      custom_fields: {
        Row: {
          id: string
          organization_id: string
          entity_type: string
          name: string
          field_type: string
          options: Json | null
          is_required: boolean
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          entity_type: string
          name: string
          field_type: string
          options?: Json | null
          is_required?: boolean
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          entity_type?: string
          name?: string
          field_type?: string
          options?: Json | null
          is_required?: boolean
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'custom_fields_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      document_versions: {
        Row: {
          id: string
          document_id: string
          organization_id: string
          version: number
          content: Json
          edited_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          document_id: string
          organization_id: string
          version: number
          content: Json
          edited_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          organization_id?: string
          version?: number
          content?: Json
          edited_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'document_versions_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'document_versions_edited_by_fkey'
            columns: ['edited_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'document_versions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      documents: {
        Row: {
          id: string
          organization_id: string
          project_id: string
          title: string
          content: Json | null
          version: number
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          project_id: string
          title: string
          content?: Json | null
          version?: number
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          project_id?: string
          title?: string
          content?: Json | null
          version?: number
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'documents_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'documents_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      events: {
        Row: {
          id: string
          organization_id: string
          event_type: string
          resource_id: string | null
          actor_id: string | null
          payload: Json
          source: string
          processed: boolean
          processed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          event_type: string
          resource_id?: string | null
          actor_id?: string | null
          payload: Json
          source?: string
          processed?: boolean
          processed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          event_type?: string
          resource_id?: string | null
          actor_id?: string | null
          payload?: Json
          source?: string
          processed?: boolean
          processed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'events_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      feature_flags: {
        Row: {
          id: string
          key: string
          description: string | null
          is_enabled: boolean
          rules: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          description?: string | null
          is_enabled?: boolean
          rules?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          description?: string | null
          is_enabled?: boolean
          rules?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      import_export_jobs: {
        Row: {
          id: string
          organization_id: string
          type: string
          status: string
          entity_type: string
          file_path: string | null
          config: Json
          result: Json | null
          started_by: string | null
          started_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          type: string
          status?: string
          entity_type: string
          file_path?: string | null
          config?: Json
          result?: Json | null
          started_by?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          type?: string
          status?: string
          entity_type?: string
          file_path?: string | null
          config?: Json
          result?: Json | null
          started_by?: string | null
          started_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'import_export_jobs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'import_export_jobs_started_by_fkey'
            columns: ['started_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      integrations: {
        Row: {
          id: string
          organization_id: string
          provider: string
          status: string
          access_token: string | null
          refresh_token: string | null
          token_expires_at: string | null
          config: Json
          last_error: string | null
          connected_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          provider: string
          status?: string
          access_token?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          config?: Json
          last_error?: string | null
          connected_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          access_token?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          config?: Json
          last_error?: string | null
          connected_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'integrations_connected_by_fkey'
            columns: ['connected_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'integrations_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      kanban_boards: {
        Row: {
          id: string
          project_id: string | null
          task_id: string | null
          organization_id: string
          name: string
          is_default: boolean
          created_at: string
        }
        Insert: {
          id?: string
          project_id?: string | null
          task_id?: string | null
          organization_id: string
          name?: string
          is_default?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string | null
          task_id?: string | null
          organization_id?: string
          name?: string
          is_default?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'kanban_boards_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kanban_boards_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kanban_boards_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
        ]
      }
      kanban_columns: {
        Row: {
          id: string
          board_id: string
          organization_id: string
          name: string
          color: string | null
          position: number
          wip_limit: number | null
          is_done_column: boolean
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          board_id: string
          organization_id: string
          name: string
          color?: string | null
          position?: number
          wip_limit?: number | null
          is_done_column?: boolean
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          board_id?: string
          organization_id?: string
          name?: string
          color?: string | null
          position?: number
          wip_limit?: number | null
          is_done_column?: boolean
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'kanban_columns_board_id_fkey'
            columns: ['board_id']
            isOneToOne: false
            referencedRelation: 'kanban_boards'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kanban_columns_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      kanban_view_configs: {
        Row: {
          id: string
          organization_id: string
          board_id: string
          created_by: string
          name: string
          is_default: boolean
          is_shared: boolean
          group_by: string
          group_field_id: string | null
          column_config: Json
          card_fields: Json
          card_color_by: string
          card_color_map: Json | null
          swimlane_by: string
          sort_by: string
          sort_order: string
          filters: Json
          show_empty_columns: boolean
          show_column_count: boolean
          compact_mode: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          board_id: string
          created_by: string
          name?: string
          is_default?: boolean
          is_shared?: boolean
          group_by?: string
          group_field_id?: string | null
          column_config?: Json
          card_fields?: Json
          card_color_by?: string
          card_color_map?: Json | null
          swimlane_by?: string
          sort_by?: string
          sort_order?: string
          filters?: Json
          show_empty_columns?: boolean
          show_column_count?: boolean
          compact_mode?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          board_id?: string
          created_by?: string
          name?: string
          is_default?: boolean
          is_shared?: boolean
          group_by?: string
          group_field_id?: string | null
          column_config?: Json
          card_fields?: Json
          card_color_by?: string
          card_color_map?: Json | null
          swimlane_by?: string
          sort_by?: string
          sort_order?: string
          filters?: Json
          show_empty_columns?: boolean
          show_column_count?: boolean
          compact_mode?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'kanban_view_configs_board_id_fkey'
            columns: ['board_id']
            isOneToOne: false
            referencedRelation: 'kanban_boards'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kanban_view_configs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kanban_view_configs_group_field_id_fkey'
            columns: ['group_field_id']
            isOneToOne: false
            referencedRelation: 'custom_fields'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'kanban_view_configs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      labels: {
        Row: {
          id: string
          organization_id: string
          project_id: string | null
          name: string
          color: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          project_id?: string | null
          name: string
          color: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          project_id?: string | null
          name?: string
          color?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'labels_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'labels_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      notification_preferences: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          preferences: Json
          quiet_hours: Json | null
          digest_mode: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          preferences?: Json
          quiet_hours?: Json | null
          digest_mode?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          preferences?: Json
          quiet_hours?: Json | null
          digest_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notification_preferences_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          type: string
          title: string
          body: string | null
          data: Json | null
          is_read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          type: string
          title: string
          body?: string | null
          data?: Json | null
          is_read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          type?: string
          title?: string
          body?: string | null
          data?: Json | null
          is_read?: boolean
          read_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      org_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: string
          branch_id: string | null
          is_default: boolean
          joined_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role?: string
          branch_id?: string | null
          is_default?: boolean
          joined_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: string
          branch_id?: string | null
          is_default?: boolean
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'org_members_branch_id_fkey'
            columns: ['branch_id']
            isOneToOne: false
            referencedRelation: 'branches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_members_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          logo_url: string | null
          address: Json | null
          billing_email: string | null
          tax_id: string | null
          currency: string
          timezone: string
          settings: Json
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          plan_id: string | null
          trial_ends_at: string | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          logo_url?: string | null
          address?: Json | null
          billing_email?: string | null
          tax_id?: string | null
          currency?: string
          timezone?: string
          settings?: Json
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan_id?: string | null
          trial_ends_at?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          logo_url?: string | null
          address?: Json | null
          billing_email?: string | null
          tax_id?: string | null
          currency?: string
          timezone?: string
          settings?: Json
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan_id?: string | null
          trial_ends_at?: string | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'organizations_plan_id_fkey'
            columns: ['plan_id']
            isOneToOne: false
            referencedRelation: 'plans'
            referencedColumns: ['id']
          },
        ]
      }
      pdf_templates: {
        Row: {
          id: string
          organization_id: string
          doc_type: string
          name: string
          template_data: Json
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          doc_type: string
          name: string
          template_data: Json
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          doc_type?: string
          name?: string
          template_data?: Json
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pdf_templates_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      plans: {
        Row: {
          id: string
          name: string
          display_name: string
          stripe_price_id_monthly: string | null
          stripe_price_id_annual: string | null
          limits: Json
          features: Json
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          display_name: string
          stripe_price_id_monthly?: string | null
          stripe_price_id_annual?: string | null
          limits?: Json
          features?: Json
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          display_name?: string
          stripe_price_id_monthly?: string | null
          stripe_price_id_annual?: string | null
          limits?: Json
          features?: Json
          sort_order?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
        ]
      }
      portal_project_access: {
        Row: {
          id: string
          portal_user_id: string
          project_id: string
          organization_id: string
          can_comment: boolean
          can_upload: boolean
          granted_by: string | null
          granted_at: string
        }
        Insert: {
          id?: string
          portal_user_id: string
          project_id: string
          organization_id: string
          can_comment?: boolean
          can_upload?: boolean
          granted_by?: string | null
          granted_at?: string
        }
        Update: {
          id?: string
          portal_user_id?: string
          project_id?: string
          organization_id?: string
          can_comment?: boolean
          can_upload?: boolean
          granted_by?: string | null
          granted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'portal_project_access_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_project_access_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_project_access_portal_user_id_fkey'
            columns: ['portal_user_id']
            isOneToOne: false
            referencedRelation: 'portal_users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_project_access_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      portal_users: {
        Row: {
          id: string
          organization_id: string
          email: string
          full_name: string
          user_id: string | null
          status: string
          invited_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          email: string
          full_name: string
          user_id?: string | null
          status?: string
          invited_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          email?: string
          full_name?: string
          user_id?: string | null
          status?: string
          invited_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'portal_users_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_users_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'portal_users_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          avatar_url: string | null
          phone: string | null
          timezone: string | null
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string
          avatar_url?: string | null
          phone?: string | null
          timezone?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          avatar_url?: string | null
          phone?: string | null
          timezone?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      project_members: {
        Row: {
          id: string
          project_id: string
          user_id: string
          organization_id: string
          role: string
          joined_at: string
        }
        Insert: {
          id?: string
          project_id: string
          user_id: string
          organization_id: string
          role?: string
          joined_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          user_id?: string
          organization_id?: string
          role?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_members_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      projects: {
        Row: {
          id: string
          organization_id: string
          workspace_id: string
          name: string
          description: string | null
          status: string
          priority: string | null
          start_date: string | null
          end_date: string | null
          budget: number | null
          visibility: string
          settings: Json
          last_task_number: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          workspace_id: string
          name: string
          description?: string | null
          status?: string
          priority?: string | null
          start_date?: string | null
          end_date?: string | null
          budget?: number | null
          visibility?: string
          settings?: Json
          last_task_number?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          workspace_id?: string
          name?: string
          description?: string | null
          status?: string
          priority?: string | null
          start_date?: string | null
          end_date?: string | null
          budget?: number | null
          visibility?: string
          settings?: Json
          last_task_number?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'projects_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'projects_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'projects_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      roles: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          is_system: boolean
          permissions: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          is_system?: boolean
          permissions?: Json
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          is_system?: boolean
          permissions?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'roles_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      subtasks: {
        Row: {
          id: string
          organization_id: string
          task_id: string
          kanban_column_id: string | null
          title: string
          description: Json | null
          status: string
          priority: string
          assignee_id: string | null
          due_date: string | null
          estimated_hours: number | null
          position: number
          started_at: string | null
          completed_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          task_id: string
          kanban_column_id?: string | null
          title: string
          description?: Json | null
          status?: string
          priority?: string
          assignee_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          position?: number
          started_at?: string | null
          completed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          task_id?: string
          kanban_column_id?: string | null
          title?: string
          description?: Json | null
          status?: string
          priority?: string
          assignee_id?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          position?: number
          started_at?: string | null
          completed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'subtasks_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subtasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subtasks_kanban_column_id_fkey'
            columns: ['kanban_column_id']
            isOneToOne: false
            referencedRelation: 'kanban_columns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subtasks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'subtasks_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
        ]
      }
      system_notices: {
        Row: {
          id: string
          title: string
          body: string
          type: string
          target: Json
          starts_at: string
          ends_at: string | null
          is_active: boolean
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          body: string
          type: string
          target?: Json
          starts_at?: string
          ends_at?: string | null
          is_active?: boolean
          created_by: string
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          body?: string
          type?: string
          target?: Json
          starts_at?: string
          ends_at?: string | null
          is_active?: boolean
          created_by?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      task_dependencies: {
        Row: {
          id: string
          organization_id: string
          predecessor_id: string
          successor_id: string
          dependency_type: string
          lag_days: number
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          predecessor_id: string
          successor_id: string
          dependency_type?: string
          lag_days?: number
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          predecessor_id?: string
          successor_id?: string
          dependency_type?: string
          lag_days?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_dependencies_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_dependencies_predecessor_id_fkey'
            columns: ['predecessor_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_dependencies_successor_id_fkey'
            columns: ['successor_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
        ]
      }
      task_labels: {
        Row: {
          task_id: string
          label_id: string
          organization_id: string
        }
        Insert: {
          task_id: string
          label_id: string
          organization_id: string
        }
        Update: {
          task_id?: string
          label_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'task_labels_label_id_fkey'
            columns: ['label_id']
            isOneToOne: false
            referencedRelation: 'labels'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_labels_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'task_labels_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'tasks'
            referencedColumns: ['id']
          },
        ]
      }
      tasks: {
        Row: {
          id: string
          organization_id: string
          project_id: string
          kanban_column_id: string | null
          title: string
          description: Json | null
          status: string
          priority: string
          assignee_id: string | null
          assigner_id: string | null
          start_date: string | null
          due_date: string | null
          estimated_hours: number | null
          actual_hours: number | null
          position: number
          task_number: number
          is_milestone: boolean
          started_at: string | null
          completed_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          project_id: string
          kanban_column_id?: string | null
          title: string
          description?: Json | null
          status?: string
          priority?: string
          assignee_id?: string | null
          assigner_id?: string | null
          start_date?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          actual_hours?: number | null
          position?: number
          task_number: number
          is_milestone?: boolean
          started_at?: string | null
          completed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          project_id?: string
          kanban_column_id?: string | null
          title?: string
          description?: Json | null
          status?: string
          priority?: string
          assignee_id?: string | null
          assigner_id?: string | null
          start_date?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          actual_hours?: number | null
          position?: number
          task_number?: number
          is_milestone?: boolean
          started_at?: string | null
          completed_at?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assigner_id_fkey'
            columns: ['assigner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_kanban_column_id_fkey'
            columns: ['kanban_column_id']
            isOneToOne: false
            referencedRelation: 'kanban_columns'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      usage_counters: {
        Row: {
          id: string
          organization_id: string
          metric: string
          current_value: number
          limit_value: number | null
          period_start: string
          period_end: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          metric: string
          current_value?: number
          limit_value?: number | null
          period_start: string
          period_end: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          metric?: string
          current_value?: number
          limit_value?: number | null
          period_start?: string
          period_end?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'usage_counters_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      user_sessions: {
        Row: {
          id: string
          user_id: string
          organization_id: string | null
          device: string | null
          ip_address: unknown | null
          user_agent: string | null
          fingerprint: string | null
          last_active_at: string
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id?: string | null
          device?: string | null
          ip_address?: unknown | null
          user_agent?: string | null
          fingerprint?: string | null
          last_active_at?: string
          revoked_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string | null
          device?: string | null
          ip_address?: unknown | null
          user_agent?: string | null
          fingerprint?: string | null
          last_active_at?: string
          revoked_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_sessions_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          id: string
          endpoint_id: string
          organization_id: string
          event_type: string
          payload: Json
          status_code: number | null
          response_body: string | null
          error: string | null
          attempt: number
          delivered_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          endpoint_id: string
          organization_id: string
          event_type: string
          payload: Json
          status_code?: number | null
          response_body?: string | null
          error?: string | null
          attempt?: number
          delivered_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          endpoint_id?: string
          organization_id?: string
          event_type?: string
          payload?: Json
          status_code?: number | null
          response_body?: string | null
          error?: string | null
          attempt?: number
          delivered_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webhook_deliveries_endpoint_id_fkey'
            columns: ['endpoint_id']
            isOneToOne: false
            referencedRelation: 'webhook_endpoints'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webhook_deliveries_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          id: string
          organization_id: string
          url: string
          description: string | null
          events: string[]
          secret: string
          is_active: boolean
          last_success_at: string | null
          last_failure_at: string | null
          failure_count: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          url: string
          description?: string | null
          events: string[]
          secret: string
          is_active?: boolean
          last_success_at?: string | null
          last_failure_at?: string | null
          failure_count?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          url?: string
          description?: string | null
          events?: string[]
          secret?: string
          is_active?: boolean
          last_success_at?: string | null
          last_failure_at?: string | null
          failure_count?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webhook_endpoints_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webhook_endpoints_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_runs: {
        Row: {
          id: string
          workflow_id: string
          organization_id: string
          status: string
          trigger_data: Json
          started_at: string
          completed_at: string | null
          duration_ms: number | null
          error: string | null
          step_count: number
        }
        Insert: {
          id?: string
          workflow_id: string
          organization_id: string
          status?: string
          trigger_data: Json
          started_at?: string
          completed_at?: string | null
          duration_ms?: number | null
          error?: string | null
          step_count?: number
        }
        Update: {
          id?: string
          workflow_id?: string
          organization_id?: string
          status?: string
          trigger_data?: Json
          started_at?: string
          completed_at?: string | null
          duration_ms?: number | null
          error?: string | null
          step_count?: number
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_runs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_runs_workflow_id_fkey'
            columns: ['workflow_id']
            isOneToOne: false
            referencedRelation: 'workflows'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_step_logs: {
        Row: {
          id: string
          run_id: string
          organization_id: string
          node_id: string
          node_type: string
          input: Json | null
          output: Json | null
          status: string
          error: string | null
          started_at: string
          completed_at: string | null
          duration_ms: number | null
        }
        Insert: {
          id?: string
          run_id: string
          organization_id: string
          node_id: string
          node_type: string
          input?: Json | null
          output?: Json | null
          status: string
          error?: string | null
          started_at?: string
          completed_at?: string | null
          duration_ms?: number | null
        }
        Update: {
          id?: string
          run_id?: string
          organization_id?: string
          node_id?: string
          node_type?: string
          input?: Json | null
          output?: Json | null
          status?: string
          error?: string | null
          started_at?: string
          completed_at?: string | null
          duration_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_step_logs_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_step_logs_run_id_fkey'
            columns: ['run_id']
            isOneToOne: false
            referencedRelation: 'workflow_runs'
            referencedColumns: ['id']
          },
        ]
      }
      workflows: {
        Row: {
          id: string
          organization_id: string
          workspace_id: string
          name: string
          description: string | null
          is_active: boolean
          trigger_type: string
          trigger_config: Json
          graph: Json
          webhook_token: string | null
          cron_expression: string | null
          last_run_at: string | null
          run_count: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          workspace_id: string
          name: string
          description?: string | null
          is_active?: boolean
          trigger_type: string
          trigger_config?: Json
          graph?: Json
          webhook_token?: string | null
          cron_expression?: string | null
          last_run_at?: string | null
          run_count?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          workspace_id?: string
          name?: string
          description?: string | null
          is_active?: boolean
          trigger_type?: string
          trigger_config?: Json
          graph?: Json
          webhook_token?: string | null
          cron_expression?: string | null
          last_run_at?: string | null
          run_count?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workflows_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflows_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflows_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          organization_id: string
          role: string
          joined_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          organization_id: string
          role?: string
          joined_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          organization_id?: string
          role?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workspace_members_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workspace_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workspace_members_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
        ]
      }
      workspaces: {
        Row: {
          id: string
          organization_id: string
          name: string
          slug: string
          description: string | null
          color: string | null
          icon: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          slug: string
          description?: string | null
          color?: string | null
          icon?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          slug?: string
          description?: string | null
          color?: string | null
          icon?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workspaces_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workspaces_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      active_notices_for_org: {
        Args: {
          org: string
        }
        Returns: Database['public']['Tables']['system_notices']['Row'][]
      }
      apply_updated_at_triggers: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      can_access_project: {
        Args: {
          proj_id: string
        }
        Returns: boolean
      }
      create_organization: {
        Args: {
          p_name: string
          p_slug: string
          p_timezone?: string
          p_currency?: string
        }
        Returns: Database['public']['Tables']['organizations']['Row']
      }
      current_auth_context: {
        Args: {
          p_org_slug?: string
        }
        Returns: unknown
      }
      current_org_role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      custom_access_token_hook: {
        Args: {
          event: Json
        }
        Returns: Json
      }
      decrypt_secret: {
        Args: {
          ciphertext: string
          key: string
        }
        Returns: string
      }
      encrypt_secret: {
        Args: {
          plaintext: string
          key: string
        }
        Returns: string
      }
      event_resource_name: {
        Args: {
          table_name: string
        }
        Returns: string
      }
      feature_enabled: {
        Args: {
          flag_key: string
          org: string
        }
        Returns: boolean
      }
      grant_columns_except: {
        Args: {
          p_table: string
          p_privilege: string
          p_except: string[]
          p_role: string
        }
        Returns: undefined
      }
      has_org_role: {
        Args: {
          minimum: string
        }
        Returns: boolean
      }
      increment_usage: {
        Args: {
          org: string
          p_metric: string
          p_delta?: number
        }
        Returns: number
      }
      is_org_member: {
        Args: {
          org: string
        }
        Returns: boolean
      }
      is_platform_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_portal_user: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_project_member: {
        Args: {
          proj_id: string
        }
        Returns: boolean
      }
      is_workspace_member: {
        Args: {
          ws_id: string
        }
        Returns: boolean
      }
      jsonb_diff: {
        Args: {
          old_row: Json
          new_row: Json
        }
        Returns: Json
      }
      next_doc_number: {
        Args: {
          org: string
          p_doc_type: string
          p_prefix?: string
          p_reset_period?: string
        }
        Returns: string
      }
      org_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      org_role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      portal_can_access_project: {
        Args: {
          proj_id: string
        }
        Returns: boolean
      }
      portal_can_access_task: {
        Args: {
          t_id: string
        }
        Returns: boolean
      }
      portal_can_comment_on_project: {
        Args: {
          proj_id: string
        }
        Returns: boolean
      }
      shares_org_with: {
        Args: {
          target_user: string
        }
        Returns: boolean
      }
      slug_available: {
        Args: {
          p_slug: string
        }
        Returns: boolean
      }
      target_matches: {
        Args: {
          target: Json
          org: string
        }
        Returns: boolean
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]

export type TableName = keyof PublicSchema["Tables"]
