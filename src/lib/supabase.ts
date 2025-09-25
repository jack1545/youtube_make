import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Validate Supabase configuration
const isValidUrl = supabaseUrl && 
  supabaseUrl !== 'your_supabase_url' && 
  supabaseUrl !== 'https://your-project-id.supabase.co' &&
  (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://'))

const isValidKey = supabaseAnonKey && supabaseAnonKey !== 'your_supabase_anon_key'

// Create a mock client for demo mode
const createMockClient = () => ({
  from: () => ({
    select: () => {
      const builder = {
        data: [] as never[],
        error: null as null,
        eq: () => builder,
        order: () => builder,
        maybeSingle: () => ({
          data: null,
          error: null
        })
      }
      return builder
    },
    insert: () => ({ 
      select: () => ({ 
        single: () => ({ 
          data: null, 
          error: null 
        }) 
      }) 
    }),
    upsert: () => ({
      select: () => ({
        single: () => ({
          data: null,
          error: null
        })
      })
    }),
    update: () => ({ 
      eq: () => ({ 
        select: () => ({
          single: () => ({ 
            data: null, 
            error: null 
          })
        })
      }) 
    }),
    delete: () => ({
      eq: () => ({
        eq: () => ({
          data: null,
          error: null
        })
      })
    })
  })
})

export const isDemoMode = !isValidUrl || !isValidKey

if (isDemoMode) {
  console.warn('⚠️  Supabase configuration is incomplete. Running in demo mode with local storage.')
  console.warn('   To enable full functionality:')
  console.warn('   1. Create a Supabase project at https://supabase.com')
  console.warn('   2. Update NEXT_PUBLIC_SUPABASE_URL in your .env.local file')
  console.warn('   3. Update NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env.local file')
}

export const supabase = (isDemoMode ? createMockClient() : createClient(supabaseUrl, supabaseAnonKey)) as any