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
          scope?: Database["public"]["Enums"]["capture_scope"]
          sensitivity?: Database["public"]["Enums"]["sensitivity_level"]
          source?: Database["public"]["Enums"]["capture_source"]
          source_item_id?: string | null
          status?: Database["public"]["Enums"]["capture_session_state"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_sessions_source_item_owner_fk"
            columns: ["source_item_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_items"
            referencedColumns: ["id", "owner_user_id"]
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
      processing_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          failure_reason: string | null
          id: string
          job_type: string
          next_attempt_at: string
          owner_user_id: string
          source_version_id: string
          status: Database["public"]["Enums"]["processing_state"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          job_type: string
          next_attempt_at?: string
          owner_user_id: string
          source_version_id: string
          status?: Database["public"]["Enums"]["processing_state"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          job_type?: string
          next_attempt_at?: string
          owner_user_id?: string
          source_version_id?: string
          status?: Database["public"]["Enums"]["processing_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_version_owner_fk"
            columns: ["source_version_id", "owner_user_id"]
            isOneToOne: false
            referencedRelation: "source_versions"
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
          title?: string
          updated_at?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_source_version_capture_limits: {
        Args: { checked_source_version_id: string }
        Returns: undefined
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
      is_valid_attachment_manifest: {
        Args: { manifest: Json }
        Returns: boolean
      }
      is_valid_missing_elements: {
        Args: { missing_elements: string[] }
        Returns: boolean
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
      processing_state:
        | "queued"
        | "processing"
        | "complete"
        | "failed"
        | "paused"
      sensitivity_level: "normal" | "sensitive" | "strictly_sensitive"
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
      processing_state: [
        "queued",
        "processing",
        "complete",
        "failed",
        "paused",
      ],
      sensitivity_level: ["normal", "sensitive", "strictly_sensitive"],
    },
  },
} as const
