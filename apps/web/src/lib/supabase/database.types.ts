export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      capture_sessions: {
        Row: {
          created_at: string
          expected_attachments: Json
          expires_at: string
          external_ref: string | null
          failure_reason: string | null
          finalized_at: string | null
          id: string
          idempotency_key: string
          owner_user_id: string
          recovery_of_capture_session_id: string | null
          resolved_at: string | null
          resolved_by_capture_session_id: string | null
          result_source_version_id: string | null
          scope: Database["public"]["Enums"]["capture_scope"]
          sensitivity: Database["public"]["Enums"]["sensitivity_level"]
          source: Database["public"]["Enums"]["capture_source"]
          source_item_id: string | null
          status: Database["public"]["Enums"]["capture_session_state"]
          title: string
        }
        Insert: {
          created_at?: string
          expected_attachments?: Json
          expires_at: string
          external_ref?: string | null
          failure_reason?: string | null
          finalized_at?: string | null
          id?: string
          idempotency_key: string
          owner_user_id: string
          recovery_of_capture_session_id?: string | null
          resolved_at?: string | null
          resolved_by_capture_session_id?: string | null
          result_source_version_id?: string | null
          scope: Database["public"]["Enums"]["capture_scope"]
          sensitivity: Database["public"]["Enums"]["sensitivity_level"]
          source: Database["public"]["Enums"]["capture_source"]
          source_item_id?: string | null
          status?: Database["public"]["Enums"]["capture_session_state"]
          title: string
        }
        Update: {
          created_at?: string
          expected_attachments?: Json
          expires_at?: string
          external_ref?: string | null
          failure_reason?: string | null
          finalized_at?: string | null
          id?: string
          idempotency_key?: string
          owner_user_id?: string
          recovery_of_capture_session_id?: string | null
          resolved_at?: string | null
          resolved_by_capture_session_id?: string | null
          result_source_version_id?: string | null
          scope?: Database["public"]["Enums"]["capture_scope"]
          sensitivity?: Database["public"]["Enums"]["sensitivity_level"]
          source?: Database["public"]["Enums"]["capture_source"]
          source_item_id?: string | null
          status?: Database["public"]["Enums"]["capture_session_state"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_sessions_recovery_owner_fk"
            columns: ["recovery_of_capture_session_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "capture_sessions"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "capture_sessions_resolution_owner_fk"
            columns: ["resolved_by_capture_session_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "capture_sessions"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "capture_sessions_result_version_item_owner_fk"
            columns: [
              "result_source_version_id",
              "source_item_id",
              "owner_user_id",
            ]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "source_item_id", "owner_user_id"]
          },
          {
            foreignKeyName: "capture_sessions_source_item_owner_fk"
            columns: ["source_item_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      citations: {
        Row: {
          claim_path: string
          created_at: string
          id: string
          knowledge_item_id: string
          origin_type: Database["public"]["Enums"]["citation_origin"]
          owner_user_id: string
          quote_excerpt: string
          review_status: Database["public"]["Enums"]["citation_review_status"]
          source_block_id: string
          space_id: string
          updated_at: string
        }
        Insert: {
          claim_path: string
          created_at?: string
          id?: string
          knowledge_item_id: string
          origin_type: Database["public"]["Enums"]["citation_origin"]
          owner_user_id: string
          quote_excerpt: string
          review_status?: Database["public"]["Enums"]["citation_review_status"]
          source_block_id: string
          space_id: string
          updated_at?: string
        }
        Update: {
          claim_path?: string
          created_at?: string
          id?: string
          knowledge_item_id?: string
          origin_type?: Database["public"]["Enums"]["citation_origin"]
          owner_user_id?: string
          quote_excerpt?: string
          review_status?: Database["public"]["Enums"]["citation_review_status"]
          source_block_id?: string
          space_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "citations_block_owner_space_fk"
            columns: ["source_block_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "source_blocks"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
          {
            foreignKeyName: "citations_knowledge_owner_space_fk"
            columns: ["knowledge_item_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
        ]
      }
      extension_pairing_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          owner_user_id: string
          used_at: string | null
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          owner_user_id: string
          used_at?: string | null
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          owner_user_id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      extension_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          label: string
          last_used_at: string | null
          owner_user_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          label: string
          last_used_at?: string | null
          owner_user_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          label?: string
          last_used_at?: string | null
          owner_user_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      knowledge_items: {
        Row: {
          conditions: string[]
          confidence: number
          created_at: string
          created_by_user_id: string
          current_version: number
          evidence_mode: Database["public"]["Enums"]["knowledge_evidence_mode"]
          extraction_key: string | null
          freshness_status: string
          human_locked_fields: string[]
          id: string
          knowledge_type: Database["public"]["Enums"]["knowledge_type"]
          l0_summary: string
          l1_content: string
          l2_content: string
          limitations: string[]
          owner_user_id: string
          review_after: string | null
          source_version_id: string | null
          space_id: string
          status: Database["public"]["Enums"]["knowledge_status"]
          title: string
          updated_at: string
        }
        Insert: {
          conditions?: string[]
          confidence: number
          created_at?: string
          created_by_user_id: string
          current_version?: number
          evidence_mode?: Database["public"]["Enums"]["knowledge_evidence_mode"]
          extraction_key?: string | null
          freshness_status?: string
          human_locked_fields?: string[]
          id?: string
          knowledge_type: Database["public"]["Enums"]["knowledge_type"]
          l0_summary: string
          l1_content: string
          l2_content?: string
          limitations?: string[]
          owner_user_id: string
          review_after?: string | null
          source_version_id?: string | null
          space_id: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          title: string
          updated_at?: string
        }
        Update: {
          conditions?: string[]
          confidence?: number
          created_at?: string
          created_by_user_id?: string
          current_version?: number
          evidence_mode?: Database["public"]["Enums"]["knowledge_evidence_mode"]
          extraction_key?: string | null
          freshness_status?: string
          human_locked_fields?: string[]
          id?: string
          knowledge_type?: Database["public"]["Enums"]["knowledge_type"]
          l0_summary?: string
          l1_content?: string
          l2_content?: string
          limitations?: string[]
          owner_user_id?: string
          review_after?: string | null
          source_version_id?: string | null
          space_id?: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_source_version_owner_fk"
            columns: ["source_version_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "knowledge_items_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      knowledge_versions: {
        Row: {
          change_origin: Database["public"]["Enums"]["knowledge_change_origin"]
          changed_by_user_id: string | null
          created_at: string
          id: string
          knowledge_item_id: string
          owner_user_id: string
          processor_run_id: string | null
          snapshot_json: Json
          space_id: string
          version: number
        }
        Insert: {
          change_origin: Database["public"]["Enums"]["knowledge_change_origin"]
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          knowledge_item_id: string
          owner_user_id: string
          processor_run_id?: string | null
          snapshot_json: Json
          space_id: string
          version: number
        }
        Update: {
          change_origin?: Database["public"]["Enums"]["knowledge_change_origin"]
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          knowledge_item_id?: string
          owner_user_id?: string
          processor_run_id?: string | null
          snapshot_json?: Json
          space_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_versions_item_owner_space_fk"
            columns: ["knowledge_item_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
          {
            foreignKeyName: "knowledge_versions_processor_run_owner_space_fk"
            columns: ["processor_run_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "processing_runs"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          id: string
          job_type: string
          last_started_at: string | null
          lease_expires_at: string | null
          locked_by: string | null
          max_attempts: number
          next_attempt_at: string
          owner_user_id: string
          source_version_id: string
          space_id: string
          status: Database["public"]["Enums"]["processing_state"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          job_type: string
          last_started_at?: string | null
          lease_expires_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_attempt_at?: string
          owner_user_id: string
          source_version_id: string
          space_id: string
          status?: Database["public"]["Enums"]["processing_state"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          job_type?: string
          last_started_at?: string | null
          lease_expires_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_attempt_at?: string
          owner_user_id?: string
          source_version_id?: string
          space_id?: string
          status?: Database["public"]["Enums"]["processing_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "processing_jobs_version_owner_fk"
            columns: ["source_version_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      processing_runs: {
        Row: {
          attempt: number
          error_code: string | null
          error_detail: string | null
          estimated_cost: number | null
          finished_at: string | null
          id: string
          input_scope: Json | null
          model: string | null
          owner_user_id: string
          processing_job_id: string
          processor_type: string
          prompt_or_pipeline_version: string | null
          provider: string | null
          result_summary: string | null
          space_id: string
          started_at: string
          status: Database["public"]["Enums"]["processing_state"]
          usage_json: Json | null
        }
        Insert: {
          attempt: number
          error_code?: string | null
          error_detail?: string | null
          estimated_cost?: number | null
          finished_at?: string | null
          id?: string
          input_scope?: Json | null
          model?: string | null
          owner_user_id: string
          processing_job_id: string
          processor_type: string
          prompt_or_pipeline_version?: string | null
          provider?: string | null
          result_summary?: string | null
          space_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["processing_state"]
          usage_json?: Json | null
        }
        Update: {
          attempt?: number
          error_code?: string | null
          error_detail?: string | null
          estimated_cost?: number | null
          finished_at?: string | null
          id?: string
          input_scope?: Json | null
          model?: string | null
          owner_user_id?: string
          processing_job_id?: string
          processor_type?: string
          prompt_or_pipeline_version?: string | null
          provider?: string | null
          result_summary?: string | null
          space_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["processing_state"]
          usage_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_runs_job_owner_space_fk"
            columns: ["processing_job_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "processing_jobs"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
          {
            foreignKeyName: "processing_runs_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      review_tasks: {
        Row: {
          created_at: string
          id: string
          knowledge_item_id: string | null
          owner_user_id: string
          priority: number
          reason: string
          resolved_at: string | null
          resolved_by_user_id: string | null
          space_id: string
          status: Database["public"]["Enums"]["review_task_status"]
          task_type: Database["public"]["Enums"]["review_task_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          knowledge_item_id?: string | null
          owner_user_id: string
          priority: number
          reason: string
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          space_id: string
          status?: Database["public"]["Enums"]["review_task_status"]
          task_type: Database["public"]["Enums"]["review_task_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          knowledge_item_id?: string | null
          owner_user_id?: string
          priority?: number
          reason?: string
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          space_id?: string
          status?: Database["public"]["Enums"]["review_task_status"]
          task_type?: Database["public"]["Enums"]["review_task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_tasks_knowledge_owner_space_fk"
            columns: ["knowledge_item_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "knowledge_items"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
          {
            foreignKeyName: "review_tasks_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      source_asset_links: {
        Row: {
          created_at: string
          id: string
          owner_user_id: string
          relation_type: Database["public"]["Enums"]["source_asset_relation"]
          source_attachment_id: string
          source_block_id: string | null
          source_message_id: string | null
          space_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_user_id: string
          relation_type: Database["public"]["Enums"]["source_asset_relation"]
          source_attachment_id: string
          source_block_id?: string | null
          source_message_id?: string | null
          space_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_user_id?: string
          relation_type?: Database["public"]["Enums"]["source_asset_relation"]
          source_attachment_id?: string
          source_block_id?: string | null
          source_message_id?: string | null
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_asset_links_attachment_owner_fk"
            columns: ["source_attachment_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_attachments"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "source_asset_links_block_owner_space_fk"
            columns: ["source_block_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "source_blocks"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
          {
            foreignKeyName: "source_asset_links_message_owner_fk"
            columns: ["source_message_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_messages"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "source_asset_links_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      source_attachments: {
        Row: {
          byte_size: number
          client_id: string
          etag: string
          file_name: string
          id: string
          mime_type: string
          owner_user_id: string
          sha256: string
          source_version_id: string
          storage_path: string
        }
        Insert: {
          byte_size: number
          client_id: string
          etag: string
          file_name: string
          id?: string
          mime_type: string
          owner_user_id: string
          sha256: string
          source_version_id: string
          storage_path: string
        }
        Update: {
          byte_size?: number
          client_id?: string
          etag?: string
          file_name?: string
          id?: string
          mime_type?: string
          owner_user_id?: string
          sha256?: string
          source_version_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_attachments_version_owner_fk"
            columns: ["source_version_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      source_blocks: {
        Row: {
          block_type: Database["public"]["Enums"]["source_block_type"]
          content_hash: string
          created_at: string
          id: string
          language: string | null
          locator_json: Json
          locator_key: string
          metadata_json: Json | null
          ordinal: number
          owner_user_id: string
          source_item_id: string
          source_message_id: string | null
          source_version_id: string
          space_id: string
          text_content: string
          updated_at: string
        }
        Insert: {
          block_type: Database["public"]["Enums"]["source_block_type"]
          content_hash: string
          created_at?: string
          id?: string
          language?: string | null
          locator_json: Json
          locator_key: string
          metadata_json?: Json | null
          ordinal: number
          owner_user_id: string
          source_item_id: string
          source_message_id?: string | null
          source_version_id: string
          space_id: string
          text_content: string
          updated_at?: string
        }
        Update: {
          block_type?: Database["public"]["Enums"]["source_block_type"]
          content_hash?: string
          created_at?: string
          id?: string
          language?: string | null
          locator_json?: Json
          locator_key?: string
          metadata_json?: Json | null
          ordinal?: number
          owner_user_id?: string
          source_item_id?: string
          source_message_id?: string | null
          source_version_id?: string
          space_id?: string
          text_content?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_blocks_item_owner_space_fk"
            columns: ["source_item_id", "owner_user_id", "space_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "owner_user_id", "space_id"]
          },
          {
            foreignKeyName: "source_blocks_message_version_item_owner_fk"
            columns: [
              "source_message_id",
              "source_version_id",
              "source_item_id",
              "owner_user_id",
            ]
            isOneToOne: false
            referencedRelation: "source_messages"
            referencedColumns: [
              "id",
              "source_version_id",
              "source_item_id",
              "owner_user_id",
            ]
          },
          {
            foreignKeyName: "source_blocks_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
          {
            foreignKeyName: "source_blocks_version_item_owner_fk"
            columns: ["source_version_id", "source_item_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "source_item_id", "owner_user_id"]
          },
        ]
      }
      source_items: {
        Row: {
          archived_at: string | null
          created_at: string
          current_version: number
          deleted_at: string | null
          external_ref: string | null
          id: string
          owner_user_id: string
          sensitivity: Database["public"]["Enums"]["sensitivity_level"]
          source: Database["public"]["Enums"]["capture_source"]
          space_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          external_ref?: string | null
          id?: string
          owner_user_id: string
          sensitivity: Database["public"]["Enums"]["sensitivity_level"]
          source: Database["public"]["Enums"]["capture_source"]
          space_id: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          external_ref?: string | null
          id?: string
          owner_user_id?: string
          sensitivity?: Database["public"]["Enums"]["sensitivity_level"]
          source?: Database["public"]["Enums"]["capture_source"]
          space_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_items_space_owner_fk"
            columns: ["space_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      source_messages: {
        Row: {
          body: string
          external_message_id: string
          id: string
          ordinal: number
          owner_user_id: string
          role: string
          source_item_id: string
          source_version_id: string
        }
        Insert: {
          body: string
          external_message_id: string
          id?: string
          ordinal: number
          owner_user_id: string
          role: string
          source_item_id: string
          source_version_id: string
        }
        Update: {
          body?: string
          external_message_id?: string
          id?: string
          ordinal?: number
          owner_user_id?: string
          role?: string
          source_item_id?: string
          source_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_messages_version_item_owner_fk"
            columns: ["source_version_id", "source_item_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
            referencedColumns: ["id", "source_item_id", "owner_user_id"]
          },
        ]
      }
      source_versions: {
        Row: {
          capture_session_id: string
          capture_status: Database["public"]["Enums"]["capture_completeness"]
          content_fingerprint: string
          created_at: string
          id: string
          missing_elements: string[]
          owner_user_id: string
          raw_text: string
          source_item_id: string
          version: number
        }
        Insert: {
          capture_session_id: string
          capture_status: Database["public"]["Enums"]["capture_completeness"]
          content_fingerprint: string
          created_at?: string
          id?: string
          missing_elements?: string[]
          owner_user_id: string
          raw_text: string
          source_item_id: string
          version: number
        }
        Update: {
          capture_session_id?: string
          capture_status?: Database["public"]["Enums"]["capture_completeness"]
          content_fingerprint?: string
          created_at?: string
          id?: string
          missing_elements?: string[]
          owner_user_id?: string
          raw_text?: string
          source_item_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_versions_capture_session_item_owner_fk"
            columns: ["capture_session_id", "source_item_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "capture_sessions"
            referencedColumns: ["id", "source_item_id", "owner_user_id"]
          },
          {
            foreignKeyName: "source_versions_source_item_owner_fk"
            columns: ["source_item_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      space_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["space_member_role"]
          space_id: string
          space_owner_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["space_member_role"]
          space_id: string
          space_owner_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["space_member_role"]
          space_id?: string
          space_owner_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_members_space_owner_fk"
            columns: ["space_id", "space_owner_user_id"]
            isOneToOne: false
            referencedRelation: "spaces"
            referencedColumns: ["id", "owner_user_id"]
          },
        ]
      }
      spaces: {
        Row: {
          created_at: string
          created_by_user_id: string
          id: string
          name: string
          owner_user_id: string
          type: Database["public"]["Enums"]["space_type"]
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          id?: string
          name: string
          owner_user_id: string
          type?: Database["public"]["Enums"]["space_type"]
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          id?: string
          name?: string
          owner_user_id?: string
          type?: Database["public"]["Enums"]["space_type"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_ai_knowledge_update: {
        Args: { p_changed_fields: string[]; p_locked_fields: string[] }
        Returns: undefined
      }
      assert_processing_job_ancestry: {
        Args: { p_job: Database["public"]["Tables"]["processing_jobs"]["Row"] }
        Returns: undefined
      }
      assert_source_version_capture_limits: {
        Args: { checked_source_version_id: string }
        Returns: undefined
      }
      claim_processing_jobs: {
        Args: { p_lease_seconds: number; p_limit: number; p_worker_id: string }
        Returns: {
          attempt: number
          job_id: string
          job_type: string
          lease_expires_at: string
          owner_user_id: string
          run_id: string
          source_version_id: string
          space_id: string
        }[]
      }
      complete_processing_job: {
        Args: {
          p_job_id: string
          p_result_summary: string
          p_run_id: string
          p_usage_json: Json
          p_worker_id: string
        }
        Returns: undefined
      }
      enqueue_followup_processing_job: {
        Args: {
          p_job_id: string
          p_job_type: string
          p_run_id: string
          p_worker_id: string
        }
        Returns: undefined
      }
      ensure_private_space: {
        Args: { p_owner_user_id: string }
        Returns: string
      }
      exchange_extension_pairing_code: {
        Args: {
          p_code_hash: string
          p_label: string
          p_token_expires_at: string
          p_token_hash: string
        }
        Returns: Json
      }
      fail_processing_job: {
        Args: {
          p_error_code: string
          p_error_detail: string
          p_job_id: string
          p_retryable: boolean
          p_run_id: string
          p_worker_id: string
        }
        Returns: undefined
      }
      finalize_capture: {
        Args: {
          p_attachments: Json
          p_capture_id: string
          p_capture_status: Database["public"]["Enums"]["capture_completeness"]
          p_content_fingerprint: string
          p_idempotency_key: string
          p_messages: Json
          p_missing_elements: string[]
          p_owner_user_id: string
          p_raw_text: string
        }
        Returns: Json
      }
      heartbeat_processing_job: {
        Args: {
          p_job_id: string
          p_lease_seconds: number
          p_run_id: string
          p_worker_id: string
        }
        Returns: undefined
      }
      is_valid_attachment_manifest: {
        Args: { manifest: Json }
        Returns: boolean
      }
      is_valid_human_locked_fields: {
        Args: { fields: string[] }
        Returns: boolean
      }
      is_valid_missing_elements: {
        Args: { missing_elements: string[] }
        Returns: boolean
      }
      is_valid_short_text_array: {
        Args: { p_values: string[] }
        Returns: boolean
      }
      lock_claimed_processing_job: {
        Args: {
          p_expected_job_type: string
          p_job_id: string
          p_run_id: string
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          id: string
          job_type: string
          last_started_at: string | null
          lease_expires_at: string | null
          locked_by: string | null
          max_attempts: number
          next_attempt_at: string
          owner_user_id: string
          source_version_id: string
          space_id: string
          status: Database["public"]["Enums"]["processing_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "processing_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      persist_knowledge_extraction: {
        Args: {
          p_job_id: string
          p_payload: Json
          p_prompt_version: string
          p_run_id: string
          p_worker_id: string
        }
        Returns: Json
      }
      processing_job_backoff: { Args: { p_attempt: number }; Returns: string }
      replace_source_blocks_and_enqueue_extract: {
        Args: {
          p_blocks: Json
          p_job_id: string
          p_run_id: string
          p_worker_id: string
        }
        Returns: undefined
      }
      report_capture_failure: {
        Args: {
          p_capture_id: string
          p_failure_reason: string
          p_owner_user_id: string
        }
        Returns: Json
      }
      review_knowledge_item: {
        Args: {
          p_approved_citation_ids: string[]
          p_decision: string
          p_expected_version: number
          p_knowledge_item_id: string
          p_locked_fields: string[]
          p_patch: Json
          p_rejection_reason: string
        }
        Returns: Json
      }
    }
    Enums: {
      capture_completeness: "complete" | "partial" | "failed"
      capture_scope:
        | "full_conversation"
        | "qa_pair"
        | "selection"
        | "web_page"
        | "upload"
      capture_session_state: "awaiting_upload" | "finalized" | "failed"
      capture_source:
        | "chatgpt_web"
        | "manual_text"
        | "manual_file"
        | "manual_screenshot"
      citation_origin: "ai" | "user"
      citation_review_status: "pending" | "approved" | "rejected"
      knowledge_change_origin: "ai" | "user" | "system"
      knowledge_evidence_mode: "cited" | "personal_inference"
      knowledge_status:
        | "ai_draft"
        | "pending_review"
        | "confirmed"
        | "rejected"
        | "archived"
        | "needs_review"
      knowledge_type:
        | "concept"
        | "principle"
        | "method"
        | "scenario"
        | "case"
        | "fact"
        | "opinion"
        | "question"
        | "conclusion"
      processing_state:
        | "queued"
        | "processing"
        | "complete"
        | "failed"
        | "paused"
      review_task_status: "open" | "completed" | "dismissed"
      review_task_type:
        | "knowledge_draft"
        | "low_confidence"
        | "sensitive_content"
        | "conflict"
        | "stale_knowledge"
      sensitivity_level: "normal" | "sensitive" | "strictly_sensitive"
      source_asset_relation:
        | "inline_image"
        | "screenshot"
        | "attachment"
        | "ocr_source"
        | "supplemental_evidence"
      source_block_type:
        | "heading"
        | "paragraph"
        | "list_item"
        | "table"
        | "code"
        | "message"
        | "ocr_region"
        | "repository_file"
        | "repository_excerpt"
        | "metadata"
      space_member_role: "owner" | "editor" | "viewer"
      space_type: "private" | "shared"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      capture_completeness: ["complete", "partial", "failed"],
      capture_scope: [
        "full_conversation",
        "qa_pair",
        "selection",
        "web_page",
        "upload",
      ],
      capture_session_state: ["awaiting_upload", "finalized", "failed"],
      capture_source: [
        "chatgpt_web",
        "manual_text",
        "manual_file",
        "manual_screenshot",
      ],
      citation_origin: ["ai", "user"],
      citation_review_status: ["pending", "approved", "rejected"],
      knowledge_change_origin: ["ai", "user", "system"],
      knowledge_evidence_mode: ["cited", "personal_inference"],
      knowledge_status: [
        "ai_draft",
        "pending_review",
        "confirmed",
        "rejected",
        "archived",
        "needs_review",
      ],
      knowledge_type: [
        "concept",
        "principle",
        "method",
        "scenario",
        "case",
        "fact",
        "opinion",
        "question",
        "conclusion",
      ],
      processing_state: [
        "queued",
        "processing",
        "complete",
        "failed",
        "paused",
      ],
      review_task_status: ["open", "completed", "dismissed"],
      review_task_type: [
        "knowledge_draft",
        "low_confidence",
        "sensitive_content",
        "conflict",
        "stale_knowledge",
      ],
      sensitivity_level: ["normal", "sensitive", "strictly_sensitive"],
      source_asset_relation: [
        "inline_image",
        "screenshot",
        "attachment",
        "ocr_source",
        "supplemental_evidence",
      ],
      source_block_type: [
        "heading",
        "paragraph",
        "list_item",
        "table",
        "code",
        "message",
        "ocr_region",
        "repository_file",
        "repository_excerpt",
        "metadata",
      ],
      space_member_role: ["owner", "editor", "viewer"],
      space_type: ["private", "shared"],
    },
  },
} as const
