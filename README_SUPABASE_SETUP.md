# Supabase Setup Instructions

## Prerequisites

1. Supabase account (sign up at https://supabase.com)
2. Supabase project created
3. Environment variables configured in `.env.local`

## Environment Variables

Add these to your `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_SUPABASE_REDIRECT_URI=http://localhost:3000/auth/callback
```

## Database Setup

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Run each migration file in order:
   - `supabase/migrations/001_create_chart_bars_table.sql`
   - `supabase/migrations/002_create_symbol_sync_progress_table.sql`
   - `supabase/migrations/003_create_sync_meta_table.sql`

### Option 2: Using Supabase CLI

If you have Supabase CLI installed:

```bash
# Link your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

## Verify Setup

After running migrations, verify:

1. **Tables Created**: Check in Supabase Dashboard → Table Editor
   - `chart_bars`
   - `symbol_sync_progress`
   - `sync_meta`

2. **RLS Policies**: Check in Supabase Dashboard → Authentication → Policies
   - All tables should have RLS enabled
   - Policies should allow users to access only their own data

3. **Indexes**: Check in Supabase Dashboard → Database → Indexes
   - Verify indexes are created for performance

## Testing RLS

To test Row Level Security:

1. Create a test user in Supabase Dashboard → Authentication → Users
2. Sign in with that user in your app
3. Verify the user can only see their own data

## Next Steps

After setup is complete:
- Stage 3: Repository Layer Updates
- Stage 4: Sync Service Foundation

---

**Note**: Make sure to keep your Supabase credentials secure and never commit them to version control.
