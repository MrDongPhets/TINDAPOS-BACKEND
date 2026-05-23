-- Staff attendance records
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  company_id uuid NOT NULL,
  store_id character varying NOT NULL,
  clock_in timestamp with time zone NOT NULL DEFAULT now(),
  clock_out timestamp with time zone,
  total_minutes integer,
  notes text,
  verified_with_biometric boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT staff_attendance_pkey PRIMARY KEY (id),
  CONSTRAINT staff_attendance_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id),
  CONSTRAINT staff_attendance_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

-- Staff WebAuthn biometric credentials (one per staff per device)
CREATE TABLE IF NOT EXISTS public.staff_webauthn_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  company_id uuid NOT NULL,
  credential_id text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  device_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT staff_webauthn_credentials_pkey PRIMARY KEY (id),
  CONSTRAINT staff_webauthn_credentials_credential_id_key UNIQUE (credential_id),
  CONSTRAINT staff_webauthn_credentials_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id),
  CONSTRAINT staff_webauthn_credentials_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

-- RLS
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_webauthn_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company members can manage attendance"
  ON public.staff_attendance FOR ALL
  USING (company_id IN (
    SELECT company_id FROM public.staff WHERE id = auth.uid()
    UNION
    SELECT id FROM public.companies WHERE created_by = auth.uid()
  ));

CREATE POLICY "Staff manage own webauthn credentials"
  ON public.staff_webauthn_credentials FOR ALL
  USING (company_id IN (
    SELECT company_id FROM public.staff WHERE id = auth.uid()
    UNION
    SELECT id FROM public.companies WHERE created_by = auth.uid()
  ));
