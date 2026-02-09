# Sync Engine Testing Guide

This guide walks you through testing the chart data sync functionality step by step.

## Prerequisites

Before testing, ensure you have:
- ✅ Logged in to the application
- ✅ Connected at least one cTrader account
- ✅ Imported some trades (sync analyzes trades to determine what to sync)

---

## Step 1: Verify Sync Initialization

**What to test:** Automatic sync plan creation after login

1. **Log in** to the application
2. **Open browser console** (F12 → Console tab)
3. **Look for these log messages:**
   ```
   [SyncInitializer] Created X sync plans for Y brokers, Z symbols
   [Realtime] Subscriptions started for user: <user-id>
   [Realtime] Subscribed to chart_bars
   [Realtime] Subscribed to symbol_sync_progress
   ```

**Expected Result:**
- ✅ No errors in console
- ✅ Sync plans are created automatically
- ✅ Realtime subscriptions are active

**If you see errors:**
- Check that you have trades imported
- Verify Supabase connection (check network tab)
- Check that access token is available

---

## Step 2: Check Settings Page - Sync Status

**What to test:** View sync progress in UI

1. **Navigate to Settings page** (`/settings`)
2. **Scroll to "Chart Data Sync" section**
3. **Verify you see:**
   - Overall sync status card showing:
     - Total symbols
     - Completed/Pending/Syncing/Failed counts
     - Total bars synced
     - Overall progress percentage
   - Broker sections (collapsed/expanded)
   - Individual symbol progress items

**Expected Result:**
- ✅ Sync status card displays correctly
- ✅ Brokers are listed (grouped by broker name)
- ✅ Symbols show correct status (pending/completed/syncing/failed)
- ✅ Progress bars appear for syncing symbols

**If nothing appears:**
- Check console for errors
- Verify trades are imported
- Refresh the page

---

## Step 3: Test Manual Symbol Sync

**What to test:** Manually trigger sync for a single symbol

1. **Go to Settings page**
2. **Expand a broker section**
3. **Find a symbol with status "pending"**
4. **Click the "Play" button** (▶️) next to the symbol
5. **Watch the progress:**
   - Status should change to "syncing"
   - Progress bar should appear and update
   - Console should show sync activity

**Expected Result:**
- ✅ Status changes to "syncing"
- ✅ Progress bar updates in real-time
- ✅ Status eventually changes to "completed"
- ✅ Total bars count increases
- ✅ First/Last bar dates are populated
- ✅ Last sync time is updated

**If sync fails:**
- Check console for error messages
- Verify access token is valid
- Check network tab for API errors
- Try again (may be rate-limited)

---

## Step 4: Test Broker Sync (All Symbols)

**What to test:** Sync all symbols for a broker at once

1. **Go to Settings page**
2. **Find a broker section**
3. **Click the "Play" button** (▶️) in the broker header
4. **Observe:**
   - Multiple symbols should start syncing
   - Progress updates for each symbol
   - Console shows multiple sync operations

**Expected Result:**
- ✅ All pending symbols start syncing
- ✅ Progress updates for each symbol independently
- ✅ Symbols complete one by one
- ✅ Overall progress updates correctly

**If issues occur:**
- Check if too many concurrent requests (may need to reduce concurrency)
- Verify access token hasn't expired
- Check network tab for rate limiting

---

## Step 5: Test Retry Failed Syncs

**What to test:** Retry symbols that failed to sync

1. **If you have failed symbols** (or simulate by disconnecting during sync):
   - Go to Settings page
   - Find symbols with "failed" status
   - Click the "Retry" button (🔄) in broker header
2. **Or manually retry:**
   - Click the "Retry" button (🔄) next to individual failed symbol

**Expected Result:**
- ✅ Failed symbols reset to "pending"
- ✅ Sync starts again
- ✅ Progress updates correctly
- ✅ Eventually completes successfully

**To simulate failure:**
- Start a sync
- Disconnect internet mid-sync
- Reconnect and retry

---

## Step 6: Test Offline Behavior

**What to test:** Sync behavior when offline

1. **Start a sync** (manual symbol sync)
2. **While syncing, disconnect internet** (or use DevTools → Network → Offline)
3. **Observe:**
   - Sync should pause/fail gracefully
   - Error message should appear
   - Progress should show error state
4. **Reconnect internet**
5. **Retry the sync**

**Expected Result:**
- ✅ Sync stops gracefully when offline
- ✅ Error message displayed: "Cannot sync - offline"
- ✅ Sync can be retried when back online
- ✅ No data corruption

---

## Step 7: Test Realtime Sync Updates

**What to test:** Real-time updates from Supabase

1. **Open Settings page** in one browser tab
2. **Open another tab** and manually sync a symbol (or use Supabase dashboard to update data)
3. **Watch the first tab:**
   - Progress should update automatically
   - No page refresh needed
   - Status changes reflect immediately

**Expected Result:**
- ✅ Progress updates in real-time
- ✅ No page refresh required
- ✅ Multiple tabs stay in sync

**Note:** This requires Supabase realtime to be enabled and working.

---

## Step 8: Test Chart Data Usage

**What to test:** Verify synced chart bars are used in charts

1. **Sync some chart bars** (complete at least one symbol)
2. **Navigate to a trade detail page** with a chart
3. **Verify:**
   - Chart loads correctly
   - Data appears (candlesticks/bars)
   - Chart is responsive

**Expected Result:**
- ✅ Chart displays synced data
- ✅ No errors loading chart data
- ✅ Chart works offline (if bars are synced)

**If chart doesn't load:**
- Check console for errors
- Verify bars were actually synced (check Dexie)
- Check that chart component uses correct broker

---

## Step 9: Test Progress Persistence

**What to test:** Sync progress persists after page refresh

1. **Start a sync** (or have completed syncs)
2. **Note the progress** (symbols, status, bars count)
3. **Refresh the page** (F5)
4. **Go back to Settings page**
5. **Verify progress is still there**

**Expected Result:**
- ✅ Progress persists after refresh
- ✅ Status is correct (completed/pending/etc.)
- ✅ Bar counts are accurate
- ✅ Last sync times are preserved

---

## Step 10: Test Multiple Brokers

**What to test:** Sync works with multiple brokers

1. **If you have multiple brokers:**
   - Connect accounts from different brokers
   - Import trades from each
2. **Go to Settings page**
3. **Verify:**
   - Multiple broker sections appear
   - Each broker has its own symbols
   - Sync works independently per broker
   - Chart bars are shared between accounts of same broker

**Expected Result:**
- ✅ Multiple brokers displayed correctly
- ✅ Sync works for each broker independently
- ✅ Chart bars shared correctly (same broker = same bars)

---

## Step 11: Test Error Handling

**What to test:** Graceful error handling

1. **Invalid access token:**
   - Clear localStorage (remove cTrader token)
   - Try to sync
   - Should show: "No access token available"
2. **API errors:**
   - Check console for API errors
   - Verify error messages are user-friendly
   - Verify sync can be retried

**Expected Result:**
- ✅ Clear error messages
- ✅ No crashes
- ✅ Ability to retry after fixing issues

---

## Step 12: Test Performance

**What to test:** Sync performance with large datasets

1. **Sync symbols with large date ranges** (many months/years)
2. **Monitor:**
   - Browser performance (no freezing)
   - Progress updates smoothly
   - Memory usage (check DevTools → Performance)
3. **Check:**
   - Sync completes successfully
   - Data is stored correctly
   - No memory leaks

**Expected Result:**
- ✅ Smooth progress updates
- ✅ No browser freezing
- ✅ Reasonable memory usage
- ✅ Sync completes successfully

---

## Common Issues & Solutions

### Issue: No sync plans created
**Solution:**
- Verify trades are imported
- Check console for errors
- Verify user is logged in

### Issue: Sync stuck on "syncing"
**Solution:**
- Check console for errors
- Verify access token is valid
- Check network tab for API errors
- Refresh page and retry

### Issue: Progress not updating
**Solution:**
- Check realtime subscriptions (console logs)
- Verify Supabase connection
- Refresh page

### Issue: Chart bars not appearing
**Solution:**
- Verify bars were actually synced (check Dexie)
- Check chart component uses correct broker
- Verify symbol name matches exactly

### Issue: Too many API requests
**Solution:**
- Reduce concurrency in sync settings
- Add delays between chunks
- Check rate limiting

---

## Testing Checklist

Use this checklist to track your testing:

- [ ] Step 1: Sync initialization works
- [ ] Step 2: Settings page displays correctly
- [ ] Step 3: Manual symbol sync works
- [ ] Step 4: Broker sync works
- [ ] Step 5: Retry failed syncs works
- [ ] Step 6: Offline behavior works
- [ ] Step 7: Realtime updates work
- [ ] Step 8: Chart data usage works
- [ ] Step 9: Progress persistence works
- [ ] Step 10: Multiple brokers work
- [ ] Step 11: Error handling works
- [ ] Step 12: Performance is acceptable

---

## Next Steps After Testing

Once testing is complete:
1. Report any bugs or issues
2. Note any performance concerns
3. Suggest improvements if needed
4. Proceed to next stages (if applicable)

---

## Notes

- **Development Mode:** Some console logs are verbose - this is normal
- **Rate Limiting:** cTrader API has rate limits - syncs may be throttled
- **Large Datasets:** Syncing years of data may take time - be patient
- **Network:** Ensure stable internet connection for best results
