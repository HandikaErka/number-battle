
import { createClient } from
    'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://hawtbbsxtoeldhqtnlro.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kJE3NViTZ4fy6f65dfpj0A_xdID3s85';

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);
