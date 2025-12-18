import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import './App.css';
import { FaSearch, FaTimes, FaEye, FaSpinner, FaRedo, FaWhatsapp } from 'react-icons/fa';

const API_BASE_URL = 'https://prabhag8-backend-1.onrender.com/api/voters';

// Helper function to remove duplicate voters
const removeDuplicates = (voters) => {
  if (!Array.isArray(voters) || voters.length === 0) return voters;
  
  const seen = new Map();
  const uniqueVoters = [];
  let duplicatesRemoved = 0;
  
  for (const voter of voters) {
    // Use _id as primary key, fallback to EPIC_NO, then combination of fields
    let uniqueKey = null;
    
    if (voter._id) {
      uniqueKey = `_id_${voter._id}`;
    } else if (voter.voterIdCard || voter.EPIC_NO) {
      uniqueKey = `epic_${voter.voterIdCard || voter.EPIC_NO}`;
    } else {
      // Fallback: use combination of name + mobile + AC_NO + PART_NO
      const name = (voter.name || voter.FM_NAME_EN || '').toLowerCase().trim();
      const mobile = (voter.mobileNumber || '').trim();
      const acNo = (voter.AC_NO || '').trim();
      const partNo = (voter.PART_NO || '').trim();
      uniqueKey = `combo_${name}_${mobile}_${acNo}_${partNo}`;
    }
    
    if (uniqueKey && !seen.has(uniqueKey)) {
      seen.set(uniqueKey, true);
      uniqueVoters.push(voter);
    } else if (uniqueKey) {
      duplicatesRemoved++;
    }
  }
  
  if (duplicatesRemoved > 0) {
    console.log(`🔄 Removed ${duplicatesRemoved} duplicate voters. Unique voters: ${uniqueVoters.length}`);
  }
  
  return uniqueVoters;
};

function App() {
  const [voters, setVoters] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedVoter, setSelectedVoter] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredVoters, setFilteredVoters] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchCache, setSearchCache] = useState(new Map());
  const [searchMode, setSearchMode] = useState('all'); // 'all' | 'epic' | 'mobile' | 'name'
  const [activeFilter, setActiveFilter] = useState('search'); // 'search', 'booth', 'surname', 'address'
  const [filterValue, setFilterValue] = useState(''); // For booth/surname/address filter
  const [filteredList, setFilteredList] = useState([]); // Filtered results for tabs

  // Check cache first, then load all voters with smart caching
  const loadVotersFromCache = () => {
    try {
      const cacheMeta = localStorage.getItem('voters_cache_meta');
      
      if (!cacheMeta) return false;
      
      const meta = JSON.parse(cacheMeta);
      const now = Date.now();
      const cacheAge = now - meta.timestamp;
      const CACHE_VALIDITY = 24 * 60 * 60 * 1000; // 24 hours
      
      // Check if cache is fresh
      if (cacheAge >= CACHE_VALIDITY || !meta.totalCount) {
        console.log('Cache expired, will reload');
        localStorage.removeItem('voters_cache');
        localStorage.removeItem('voters_cache_meta');
        // Clear chunked cache too
        const chunks = localStorage.getItem('voters_cache_chunks');
        if (chunks) {
          for (let i = 0; i < parseInt(chunks); i++) {
            localStorage.removeItem(`voters_cache_chunk_${i}`);
          }
          localStorage.removeItem('voters_cache_chunks');
        }
        return false;
      }
      
      // Load from cache (chunked or normal)
      let cached = localStorage.getItem('voters_cache');
      const chunks = localStorage.getItem('voters_cache_chunks');
      
      if (chunks && !cached) {
        // Load chunked cache
        const numChunks = parseInt(chunks);
        let cacheData = '';
        for (let i = 0; i < numChunks; i++) {
          const chunk = localStorage.getItem(`voters_cache_chunk_${i}`);
          if (chunk) {
            cacheData += chunk;
          }
        }
        cached = cacheData;
      }
      
      if (cached) {
        let voters = JSON.parse(cached);
        const originalCount = voters.length;
        // Remove duplicates from cache
        voters = removeDuplicates(voters);
        const cacheSizeMB = (cached.length / 1024 / 1024).toFixed(2);
        const ageMinutes = Math.round(cacheAge / 1000 / 60);
        console.log(`✅ Loading ${voters.length} unique voters from cache (${cacheSizeMB} MB, ${ageMinutes} minutes old)`);
        if (originalCount !== voters.length) {
          console.log(`🔄 Removed ${originalCount - voters.length} duplicates from cache`);
        }
        setVoters(voters);
        setTotalCount(meta.totalCount);
        return true; // Cache loaded successfully
      }
    } catch (err) {
      console.error('Error loading cache:', err);
      // Clear corrupted cache
      localStorage.removeItem('voters_cache');
      localStorage.removeItem('voters_cache_meta');
      const chunks = localStorage.getItem('voters_cache_chunks');
      if (chunks) {
        for (let i = 0; i < parseInt(chunks); i++) {
          localStorage.removeItem(`voters_cache_chunk_${i}`);
        }
        localStorage.removeItem('voters_cache_chunks');
      }
    }
    return false; // No cache or cache invalid
  };

  // Save voters to cache (only for reasonably small data sets)
  const saveVotersToCache = (voters, totalCount) => {
    try {
      // Browser localStorage quota is usually ~5–10 MB.
      // 100k voters JSON is much bigger than that, so we only cache
      // when the dataset is small enough to fit safely.
      const MAX_CACHE_VOTERS = 10000;
      if (!Array.isArray(voters) || voters.length === 0) return;

      if (voters.length > MAX_CACHE_VOTERS) {
        console.log(
          `Skipping cache: ${voters.length} voters is too large for safe localStorage (limit ${MAX_CACHE_VOTERS}).`
        );
        return;
      }

      const cacheData = JSON.stringify(voters);
      const approxSizeMB = (cacheData.length / 1024 / 1024).toFixed(2);

      const cacheMeta = JSON.stringify({
        count: voters.length,
        totalCount: totalCount,
        timestamp: Date.now()
      });

      localStorage.setItem('voters_cache', cacheData);
      localStorage.setItem('voters_cache_meta', cacheMeta);
      console.log(`Cached ${voters.length} voters successfully (~${approxSizeMB} MB).`);
    } catch (err) {
      // If quota exceeded or any other error, just log and continue without cache.
      console.error('Error saving cache (probably storage full). Skipping cache:', err);
    }
  };

  // Load all voters with pagination and caching
  const fetchAllVoters = async (retryAttempt = 0) => {
    const maxRetries = 1;
    const baseDelay = 2000;
    const pageSize = 1000;
    
    try {
      // Check cache first
      if (retryAttempt === 0 && loadVotersFromCache()) {
        setLoading(false);
        setIsRetrying(false);
        setError(null);
        console.log('Using cached voters, no API call needed');
        return; // Use cached data
      }
      
        setLoading(true);
        setError(null);
      setIsRetrying(retryAttempt > 0);
      
      console.log(`Fetching all voters... Attempt ${retryAttempt + 1}`);
      
      // First, get total count
      let firstResponse;
      try {
        firstResponse = await axios.get(API_BASE_URL, {
          timeout: 30000,
          headers: { 'Accept': 'application/json' },
          params: { limit: pageSize, page: 1 }
        });
      } catch (err) {
        firstResponse = await axios.get(API_BASE_URL, {
          timeout: 30000,
          headers: { 'Accept': 'application/json' }
        });
      }
        
      const firstResult = firstResponse.data;
      let totalCount = 0;
        let allVoters = [];
        
      // Get total count
      if (firstResult.totalCount !== undefined) {
        totalCount = firstResult.totalCount;
      } else if (firstResult.total !== undefined) {
        totalCount = firstResult.total;
      } else if (firstResult.count !== undefined) {
        totalCount = firstResult.count;
      }
      
      // Extract first page
      if (Array.isArray(firstResult)) {
        allVoters = firstResult;
      } else if (firstResult.success && Array.isArray(firstResult.data)) {
        allVoters = firstResult.data;
      } else if (firstResult.data && Array.isArray(firstResult.data)) {
        allVoters = firstResult.data;
      } else if (firstResult.voters && Array.isArray(firstResult.voters)) {
        allVoters = firstResult.voters;
      }
      
      // Remove duplicates from first page
      allVoters = removeDuplicates(allVoters);
      
      // Display first page immediately and hide loading
        setVoters(allVoters);
      setTotalCount(totalCount || allVoters.length);
      setLoading(false); // Hide loading once first page is loaded
      const dataSizeMB = (JSON.stringify(allVoters).length / 1024 / 1024).toFixed(2);
      console.log(`📊 First page loaded: ${allVoters.length} voters (${dataSizeMB} MB)`);
      
      // If we need more pages, fetch them in background (without showing loading)
      if (totalCount > 0 && allVoters.length < totalCount) {
        const totalPages = Math.ceil(totalCount / pageSize);
        const estimatedTotalMB = ((totalCount * JSON.stringify(allVoters[0] || {}).length) / 1024 / 1024).toFixed(2);
        console.log(`📊 Total Count from API: ${totalCount}`);
        console.log(`📊 First page loaded: ${allVoters.length} voters`);
        console.log(`📊 Need to fetch ${totalPages} pages total (~${estimatedTotalMB} MB estimated)`);
        console.log(`📊 Starting from page 2 to page ${totalPages}`);
        
        // Fetch remaining pages in small batches
        const batchSize = 3;
        let pagesFetched = 0;
        let pagesFailed = 0;
        for (let page = 2; page <= totalPages; page += batchSize) {
          const pagesToFetch = [];
          for (let p = page; p < Math.min(page + batchSize, totalPages + 1); p++) {
            pagesToFetch.push(p);
          }
          
          try {
            const batchPromises = pagesToFetch.map(p => {
              // Try multiple pagination formats
              const params = { limit: pageSize };
              
              // Try page-based first
              params.page = p;
              
              // Also try skip-based as fallback
              const skip = (p - 1) * pageSize;
              
              return axios.get(API_BASE_URL, {
                timeout: 30000,
                headers: { 'Accept': 'application/json' },
                params: params
              }).catch((err) => {
                // If page-based fails, try skip-based
                if (p > 1) {
                  return axios.get(API_BASE_URL, {
                    timeout: 30000,
                    headers: { 'Accept': 'application/json' },
                    params: { limit: pageSize, skip: skip }
                  }).catch(() => null);
                }
                return null;
              });
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Process results using for loop to avoid closure issues
            for (let index = 0; index < batchResults.length; index++) {
              const result = batchResults[index];
              const pageNum = pagesToFetch[index];
              
              if (result.status === 'fulfilled' && result.value) {
                const data = result.value.data;
                let pageVoters = [];
                
                if (Array.isArray(data)) {
                  pageVoters = data;
                } else if (data?.data && Array.isArray(data.data)) {
                  pageVoters = data.data;
                } else if (data?.voters && Array.isArray(data.voters)) {
                  pageVoters = data.voters;
                } else if (data?.results && Array.isArray(data.results)) {
                  pageVoters = data.results;
                }
                
                if (pageVoters.length > 0) {
                  pagesFetched++;
                  // Remove duplicates from new page data before adding
                  const uniquePageVoters = removeDuplicates(pageVoters);
                  allVoters = [...allVoters, ...uniquePageVoters];
                  // Remove duplicates from entire array periodically
                  if (pagesFetched % 5 === 0) {
                    const beforeDedup = allVoters.length;
                    allVoters = removeDuplicates(allVoters);
                    if (beforeDedup !== allVoters.length) {
                      console.log(`🔄 Periodic deduplication: ${beforeDedup} → ${allVoters.length} voters`);
                    }
                  }
                  // Update state as we go (silently in background)
                  setVoters([...allVoters]);
                  setTotalCount(totalCount);
                  const currentDataSizeMB = (JSON.stringify(allVoters).length / 1024 / 1024).toFixed(2);
                  const progressPercent = Math.round((allVoters.length / totalCount) * 100);
                  console.log(`📊 Page ${pageNum}: Got ${uniquePageVoters.length} unique voters | Total: ${allVoters.length}/${totalCount} (${progressPercent}%) - ${currentDataSizeMB} MB`);
                  // Don't show error message for background loading - keep UI clean
                } else {
                  console.warn(`⚠️ Page ${pageNum}: No voters returned`);
                  pagesFailed++;
                }
              } else {
                console.warn(`⚠️ Page ${pageNum}: Request failed - ${result.reason?.message || 'Unknown error'}`);
                pagesFailed++;
              }
            }
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (err) {
            console.warn('Batch fetch error:', err);
          }
        }
        
        // Final deduplication before saving
        const beforeFinalDedup = allVoters.length;
        allVoters = removeDuplicates(allVoters);
        if (beforeFinalDedup !== allVoters.length) {
          console.log(`🔄 Final deduplication: ${beforeFinalDedup} → ${allVoters.length} voters (removed ${beforeFinalDedup - allVoters.length} duplicates)`);
        }
        
        // Summary of pagination
        console.log(`📊 Pagination Summary:`);
        console.log(`   - Expected: ${totalCount} voters`);
        console.log(`   - Loaded: ${allVoters.length} unique voters`);
        console.log(`   - Missing: ${totalCount - allVoters.length} voters`);
        console.log(`   - Pages fetched: ${pagesFetched}, Failed: ${pagesFailed}`);
      }
      
      // Final deduplication if no pagination was needed
      if (allVoters.length > 0) {
        const beforeDedup = allVoters.length;
        allVoters = removeDuplicates(allVoters);
        if (beforeDedup !== allVoters.length) {
          console.log(`🔄 Deduplication: ${beforeDedup} → ${allVoters.length} voters`);
        }
      }
      
      // Save to cache (only unique voters)
      saveVotersToCache(allVoters, totalCount);
      
      const finalDataSizeMB = (JSON.stringify(allVoters).length / 1024 / 1024).toFixed(2);
      const missingVoters = totalCount - allVoters.length;
      if (missingVoters > 0) {
        console.warn(`⚠️ WARNING: Only loaded ${allVoters.length} out of ${totalCount} voters (${missingVoters} missing)`);
        console.warn(`⚠️ This might be due to backend pagination limits or API issues`);
      } else {
        console.log(`✅ Successfully loaded all ${allVoters.length} voters (${finalDataSizeMB} MB)`);
      }
      console.log(`✅ Cached successfully`);
      setError(null);
      setLoading(false);
      setIsRetrying(false);
      
      } catch (err) {
      console.error(`Error fetching voters (attempt ${retryAttempt + 1}):`, err);
      
      // Show detailed error only in console
      if (err.response) {
        console.error('Response error:', err.response.status, err.response.data);
      } else if (err.request) {
        console.error('Request error:', err.message);
      }
      
      if (retryAttempt < maxRetries) {
        const delay = baseDelay;
        setRetryCount(retryAttempt + 1);
        setError(`कनेक्शन समस्या... ${retryAttempt + 1}/${maxRetries} पुनः प्रयास कर रहे हैं...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchAllVoters(retryAttempt + 1);
      } else {
        // Even on failure, show error state with retry button
        setError(null);
        setLoading(false);
        setIsRetrying(false);
      }
    }
  };
  
  // Background fetch disabled - keeping system fast and stable
    
  // Check network status
  useEffect(() => {
    const checkNetwork = () => {
      if (!navigator.onLine) {
        console.warn('No internet connection');
      }
    };
    
    const handleOnline = () => {
      console.log('Internet connection restored');
      if (voters.length === 0 && !loading) {
        fetchAllVoters();
      }
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', checkNetwork);
    checkNetwork();
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', checkNetwork);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch all voters on mount
  useEffect(() => {
    fetchAllVoters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // fetchAllVoters is stable function, no need to include in deps

  // Manual retry function
  const handleRetry = () => {
    setRetryCount(0);
    fetchAllVoters(0);
  };

  // Remove duplicates from current loaded data
  const handleRemoveDuplicates = () => {
    if (voters.length === 0) {
      alert('कोई डेटा लोड नहीं है।');
      return;
    }
    
    const beforeCount = voters.length;
    const uniqueVoters = removeDuplicates(voters);
    const duplicatesRemoved = beforeCount - uniqueVoters.length;
    
    if (duplicatesRemoved > 0) {
      setVoters(uniqueVoters);
      setTotalCount(uniqueVoters.length);
      
      // Also update filtered voters if search is active
      if (searchQuery && filteredVoters.length > 0) {
        const uniqueFiltered = removeDuplicates(filteredVoters);
        setFilteredVoters(uniqueFiltered);
      }
      
      // Also update filtered list if filter is active
      if (filteredList.length > 0) {
        const uniqueFilteredList = removeDuplicates(filteredList);
        setFilteredList(uniqueFilteredList);
      }
      
      // Update cache with deduplicated data
      saveVotersToCache(uniqueVoters, uniqueVoters.length);
      
      alert(`✅ ${duplicatesRemoved} duplicate entries हटा दिए गए!\n\nपहले: ${beforeCount} voters\nअब: ${uniqueVoters.length} unique voters`);
      console.log(`✅ Removed ${duplicatesRemoved} duplicates. Now ${uniqueVoters.length} unique voters.`);
    } else {
      alert('✅ कोई duplicate entries नहीं मिले। सभी data unique है!');
    }
  };

  // Clear cache and reload
  const handleClearCache = () => {
    const confirmed = window.confirm('क्या आप cache clear करना चाहते हैं? सभी cached data delete हो जाएगी और fresh data load होगी।');
    if (!confirmed) return;
    
    localStorage.removeItem('voters_cache');
    localStorage.removeItem('voters_cache_meta');
    const chunks = localStorage.getItem('voters_cache_chunks');
    if (chunks) {
      for (let i = 0; i < parseInt(chunks); i++) {
        localStorage.removeItem(`voters_cache_chunk_${i}`);
      }
      localStorage.removeItem('voters_cache_chunks');
    }
    setSearchCache(new Map());
    console.log('Cache cleared, reloading...');
    setVoters([]);
    setFilteredVoters([]);
    setFilteredList([]);
    fetchAllVoters(0);
  };

  // WhatsApp share handler for selected voter in modal
  const handleShareOnWhatsApp = () => {
    if (!selectedVoter) return;

    const nameEn = (selectedVoter.name || selectedVoter.FM_NAME_EN || '').trim();
    const nameMr = (selectedVoter.name_mr || selectedVoter.FM_NAME_V1 || '').trim();
    const lastNameEn = (selectedVoter.LASTNAME_EN || '').trim();
    const lastNameMr = (selectedVoter.LASTNAME_V1 || '').trim();
    
    // Check if lastname is already in the name to avoid duplication
    let fullNameEn = nameEn;
    if (lastNameEn && !nameEn.toLowerCase().includes(lastNameEn.toLowerCase())) {
      fullNameEn = `${nameEn} ${lastNameEn}`.trim();
    }
    
    let fullNameMr = nameMr;
    if (lastNameMr && !nameMr.includes(lastNameMr)) {
      fullNameMr = `${nameMr} ${lastNameMr}`.trim();
    }

    const epic = selectedVoter.voterIdCard || selectedVoter.EPIC_NO || '-';
    const mobile = selectedVoter.mobileNumber || '-';
    const addressEn = selectedVoter.adr1 || '-';
    const addressMr = selectedVoter.adr2 || '-';
    const houseNo = selectedVoter.houseNumber || selectedVoter.C_HOUSE_NO || '-';
    const acNo = selectedVoter.AC_NO || '-';
    const partNo = selectedVoter.PART_NO || '-';

    const message =
      `*संपूर्ण मतदार माहिती*\n\n` +
      `👤 *नाव (मराठी):* ${fullNameMr || '-'}\n` +
      `👤 *नाव (इंग्रजी):* ${fullNameEn || '-'}\n` +
      `🪪 *मतदान कार्ड क्र.:* ${epic}\n` +
      `📞 *मोबाईल नं.:* ${mobile}\n` +
      `🏛️ *विधानसभा:* ${acNo}\n` +
      `📄 *यादी भाग:* ${partNo}\n` +
      `📍 *पत्ता (मराठी):* ${addressMr}\n` +
      `📍 *पत्ता (इंग्रजी):* ${addressEn}\n` +
      `🏠 *घर क्र.:* ${houseNo}`;

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  // Optimized search function with better performance and search modes
  const searchVoter = useMemo(() => {
    return (voter, query) => {
    if (!query || query.trim().length === 0) return false;
    
    const q = query.toLowerCase().trim();
    if (q.length === 0) return false;
    
      // Pre-compute searchable fields once
      const nameEn = (voter.name || voter.FM_NAME_EN || '').toLowerCase();
      const nameMr = (voter.name_mr || voter.FM_NAME_V1 || '').toLowerCase();
      const lastNameEn = (voter.LASTNAME_EN || '').toLowerCase();
      const lastNameMr = (voter.LASTNAME_V1 || '').toLowerCase();
      const epicNo = (voter.voterIdCard || voter.EPIC_NO || '').toLowerCase();
      const mobile = (voter.mobileNumber || '').toLowerCase();
      
      // Mode-specific search
      if (searchMode === 'epic') {
        return epicNo.includes(q);
      }
      
      if (searchMode === 'mobile') {
        return mobile.includes(q);
      }
      
      if (searchMode === 'name') {
        return (
          nameEn.includes(q) ||
          nameMr.includes(q) ||
          lastNameEn.includes(q) ||
          lastNameMr.includes(q)
        );
      }
      
      // Default: search everywhere (name + EPIC + mobile)
      // Fast exact match checks first
      if (epicNo === q || mobile === q) return true;
      
      // Then substring matches
      return (
        nameEn.includes(q) ||
        nameMr.includes(q) ||
        lastNameEn.includes(q) ||
        lastNameMr.includes(q) ||
        epicNo.includes(q) ||
        mobile.includes(q)
      );
    };
  }, [searchMode]);
  
  // Optimized client-side search - now searches ALL cached voters
  const performClientSearch = useMemo(() => {
    return (query, votersList) => {
      if (!query || query.trim().length < 2 || votersList.length === 0) {
        return [];
      }
      
      const q = query.toLowerCase().trim();
    const results = [];
      const maxResults = 5000; // Increased limit since we have all voters cached
      
      // Search through ALL voters (no limit since they're cached)
      for (let i = 0; i < votersList.length && results.length < maxResults; i++) {
        if (searchVoter(votersList[i], q)) {
          results.push(votersList[i]);
      }
    }
    
    return results;
    };
  }, [searchVoter]);


  // Optimized search with smart debouncing and caching
  useEffect(() => {
    if (!searchQuery || !searchQuery.trim()) {
      setFilteredVoters([]);
      setIsSearching(false);
      return;
    }
    
    let query = searchQuery.trim();
    
    // Handle comma-separated EPIC numbers - take first one
    if (query.includes(',')) {
      const parts = query.split(',').map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length > 0) {
        query = parts[0]; // Use first EPIC number
        console.log('Multiple EPIC numbers detected, using first:', query);
      }
    }
    
    if (query.length < 2) {
      setFilteredVoters([]);
      setIsSearching(false);
      return;
    }

    // Check cache first
    if (searchCache.has(query)) {
      setFilteredVoters(searchCache.get(query));
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    
    // Smart debounce: shorter for short queries, longer for longer queries
    const debounceTime = query.length <= 3 ? 300 : query.length <= 6 ? 500 : 700;
    
    const searchTimeout = setTimeout(async () => {
      try {
        // 1) हमेशा सबसे पहले client-side search (fast, responsive)
        if (voters.length > 0) {
          console.log(`Using client-side search on ${voters.length} voters`);
          const localResults = performClientSearch(query, voters);

          // Remove duplicates from local search results
          const uniqueLocalResults = removeDuplicates(localResults);
          
          // Set filtered voters with unique results
          setFilteredVoters(uniqueLocalResults);
          
          // Cache client search results (only unique)
          setSearchCache(prev => {
            const newCache = new Map(prev);
            newCache.set(query, uniqueLocalResults);
            if (newCache.size > 50) {
              const firstKey = newCache.keys().next().value;
              newCache.delete(firstKey);
            }
            return newCache;
          });

          // Name / All mode में या local results मिले तो यहीं रुक जाओ (कोई API call नहीं)
          if (searchMode === 'name' || searchMode === 'all' || uniqueLocalResults.length > 0) {
            setIsSearching(false);
            return;
          }
          // EPIC / Mobile mode में और अभी भी 0 result हैं तो ही API fallback करो
        }

        // 2) EPIC / Mobile mode के लिए API search (जब local से कुछ नहीं मिला)
        const cleanQuery = query.trim().replace(/[,\s]+/g, ' ').trim();
        console.log('Using API search for:', cleanQuery);
        
        const response = await axios.get(`${API_BASE_URL}/search`, {
          params: { query: cleanQuery },
          timeout: 30000,
          headers: { 'Accept': 'application/json' }
        });
        
        console.log('Search API Response:', response.data);

        const result = response.data;
        let searchResults = [];
        
        if (result.success && Array.isArray(result.data)) {
          searchResults = result.data;
        } else if (Array.isArray(result)) {
          searchResults = result;
        } else if (result.data && Array.isArray(result.data)) {
          searchResults = result.data;
        } else if (result.voters && Array.isArray(result.voters)) {
          searchResults = result.voters;
        } else if (result.results && Array.isArray(result.results)) {
          searchResults = result.results;
        }

        console.log(`Found ${searchResults.length} results for query: ${cleanQuery}`);
        
        // If no results and query looks like EPIC number, try exact match
        if (searchResults.length === 0 && /^[A-Z0-9]{8,12}$/i.test(cleanQuery)) {
          console.log('Query looks like EPIC number, trying exact match...');
          // Try searching with exact EPIC format
          try {
            const exactResponse = await axios.get(`${API_BASE_URL}/search`, {
              params: { query: cleanQuery.toUpperCase() },
              timeout: 30000,
              headers: { 'Accept': 'application/json' }
            });
            
            const exactResult = exactResponse.data;
            if (exactResult.success && Array.isArray(exactResult.data)) {
              searchResults = exactResult.data;
            } else if (Array.isArray(exactResult)) {
              searchResults = exactResult;
            } else if (exactResult.data && Array.isArray(exactResult.data)) {
              searchResults = exactResult.data;
            }
            console.log(`Exact match found ${searchResults.length} results`);
          } catch (exactErr) {
            console.warn('Exact match search failed:', exactErr);
          }
        }

        // Remove duplicates from search results
        const uniqueSearchResults = removeDuplicates(searchResults);
        setFilteredVoters(uniqueSearchResults);
        
        // Cache API results (only unique)
        setSearchCache(prev => {
          const newCache = new Map(prev);
          newCache.set(query, uniqueSearchResults);
          if (newCache.size > 50) {
            const firstKey = newCache.keys().next().value;
            newCache.delete(firstKey);
          }
          return newCache;
        });
        
        setIsSearching(false);
      } catch (err) {
        console.error('Error searching voters:', err);
        // Fallback to client-side search if API fails (only searches loaded voters)
        if (voters.length > 0) {
          console.log('API search failed, using client-side search for loaded voters only');
          const results = performClientSearch(query, voters);
          const uniqueResults = removeDuplicates(results);
          setFilteredVoters(uniqueResults);
        } else {
          setFilteredVoters([]);
        }
        setIsSearching(false);
      }
    }, debounceTime);

    return () => {
      clearTimeout(searchTimeout);
      setIsSearching(false);
    };
  }, [searchQuery, voters, searchMode, performClientSearch, searchCache, totalCount]);

  // Get display voters - all voters or search results
  const getDisplayVoters = () => {
    if (searchQuery && searchQuery.trim()) {
      return filteredVoters;
    }
    return voters;
  };

  const displayVoters = getDisplayVoters();

  // Optimized suggestions - top 10 matches with relevance ranking
  const suggestions = useMemo(() => {
    if (!searchQuery || !searchQuery.trim() || filteredVoters.length === 0) return [];
    
    const query = searchQuery.toLowerCase().trim();
    const results = filteredVoters.slice(0, 100); // Check more for better ranking
    
    // Sort by relevance: exact matches first, then by field priority
    const ranked = results.map(voter => {
      let score = 0;
      const epicNo = (voter.voterIdCard || voter.EPIC_NO || '').toLowerCase();
      const mobile = (voter.mobileNumber || '').toLowerCase();
      const nameEn = (voter.name || voter.FM_NAME_EN || '').toLowerCase();
      const nameMr = (voter.name_mr || voter.FM_NAME_V1 || '').toLowerCase();
      
      // Exact matches get highest score
      if (epicNo === query || mobile === query) score += 100;
      else if (epicNo.startsWith(query) || mobile.startsWith(query)) score += 50;
      else if (epicNo.includes(query) || mobile.includes(query)) score += 25;
      
      // Name matches
      if (nameEn.startsWith(query) || nameMr.startsWith(query)) score += 30;
      else if (nameEn.includes(query) || nameMr.includes(query)) score += 15;
      
      return { voter, score };
    }).sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.voter);
    
    return ranked;
  }, [filteredVoters, searchQuery]);

  // Optimized search input handler
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    const hasValue = value.trim().length > 0;
    setShowSuggestions(hasValue && filteredVoters.length > 0);
  };
  
  // Handle keyboard navigation in search
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      setShowSuggestions(false);
      e.target.blur();
    } else if (e.key === 'Enter') {
      // If suggestions are visible, open first suggestion
      if (suggestions.length > 0) {
        handleSuggestionClick(suggestions[0]);
        return;
      }
      
      // Otherwise, if there are display results, open first one
      if (displayVoters.length > 0) {
        handleVoterClick(displayVoters[0]);
      }
    }
  };
  
  // Clear search
  const handleClearSearch = () => {
    setSearchQuery('');
    setFilteredVoters([]);
    setShowSuggestions(false);
  };

  // Handle suggestion click
  const handleSuggestionClick = (voter) => {
    setSelectedVoter(voter);
    setShowModal(true);
    setShowSuggestions(false);
  };

  // Handle voter click
  const handleVoterClick = (voter) => {
    setSelectedVoter(voter);
    setShowModal(true);
  };

  // Filter functions for tabs
  const filterByBooth = useMemo(() => {
    return (boothValue) => {
      if (!boothValue || boothValue.trim() === '') return [];
      const searchTerm = boothValue.toLowerCase().trim();
      return voters.filter(voter => {
        const partNo = (voter.PART_NO || '').toLowerCase();
        const pollingCenter = (voter.POLLING_CENTER || '').toLowerCase();
        const pp = (voter.pp || '').toLowerCase();
        return partNo.includes(searchTerm) || 
               pollingCenter.includes(searchTerm) || 
               pp.includes(searchTerm);
      });
    };
  }, [voters]);

  const filterBySurname = useMemo(() => {
    return (surnameValue) => {
      if (!surnameValue || surnameValue.trim() === '') return [];
      const searchTerm = surnameValue.toLowerCase().trim();
      return voters.filter(voter => {
        const lastNameEn = (voter.LASTNAME_EN || '').toLowerCase();
        const lastNameMr = (voter.LASTNAME_V1 || '').toLowerCase();
        const nameEn = (voter.name || voter.FM_NAME_EN || '').toLowerCase();
        const nameMr = (voter.name_mr || voter.FM_NAME_V1 || '').toLowerCase();
        
        // Extract last word as surname
        const nameEnParts = nameEn.split(' ');
        const nameMrParts = nameMr.split(' ');
        const lastWordEn = nameEnParts[nameEnParts.length - 1] || '';
        const lastWordMr = nameMrParts[nameMrParts.length - 1] || '';
        
        return lastNameEn.includes(searchTerm) || 
               lastNameMr.includes(searchTerm) ||
               lastWordEn.includes(searchTerm) ||
               lastWordMr.includes(searchTerm);
      });
    };
  }, [voters]);

  const filterByAddress = useMemo(() => {
    return (addressValue) => {
      if (!addressValue || addressValue.trim() === '') return [];
      const searchTerm = addressValue.toLowerCase().trim();
      return voters.filter(voter => {
        const adr1 = (voter.adr1 || '').toLowerCase();
        const adr2 = (voter.adr2 || '').toLowerCase();
        const houseNo = (voter.houseNumber || voter.C_HOUSE_NO || '').toLowerCase();
        const pollingStation = (voter.POLLING_STATION_ADR1 || voter.POLLING_STATION_ADR2 || '').toLowerCase();
        return adr1.includes(searchTerm) || 
               adr2.includes(searchTerm) ||
               houseNo.includes(searchTerm) ||
               pollingStation.includes(searchTerm);
      });
    };
  }, [voters]);

  // Handle filter change
  useEffect(() => {
    let filtered = [];
    if (activeFilter === 'booth' && filterValue) {
      filtered = filterByBooth(filterValue);
    } else if (activeFilter === 'surname' && filterValue) {
      filtered = filterBySurname(filterValue);
    } else if (activeFilter === 'address' && filterValue) {
      filtered = filterByAddress(filterValue);
    }
    
    // Remove duplicates from filtered results
    const uniqueFiltered = removeDuplicates(filtered);
    setFilteredList(uniqueFiltered);
  }, [activeFilter, filterValue, filterByBooth, filterBySurname, filterByAddress]);

  // Get unique values for dropdowns
  const uniqueBooths = useMemo(() => {
    const booths = new Set();
    voters.forEach(voter => {
      if (voter.PART_NO) booths.add(voter.PART_NO);
      if (voter.POLLING_CENTER) booths.add(voter.POLLING_CENTER);
      if (voter.pp) booths.add(voter.pp);
    });
    return Array.from(booths).sort();
  }, [voters]);

  const uniqueSurnames = useMemo(() => {
    const surnames = new Set();
    voters.forEach(voter => {
      if (voter.LASTNAME_EN) surnames.add(voter.LASTNAME_EN);
      if (voter.LASTNAME_V1) surnames.add(voter.LASTNAME_V1);
      // Extract last word from name
      const nameEn = voter.name || voter.FM_NAME_EN || '';
      const nameMr = voter.name_mr || voter.FM_NAME_V1 || '';
      if (nameEn) {
        const parts = nameEn.split(' ');
        if (parts.length > 0) surnames.add(parts[parts.length - 1]);
      }
      if (nameMr) {
        const parts = nameMr.split(' ');
        if (parts.length > 0) surnames.add(parts[parts.length - 1]);
      }
    });
    return Array.from(surnames).filter(s => s.trim() !== '').sort();
  }, [voters]);

  return (
    <div className="App">
      <header>
        <h1>प्रभाग क्रमांक 8</h1>
        <h2>मतदार शोध प्रणाली</h2>
        <h3>पुणे महानगरपालिका</h3>
      </header>

      <div className="container">
        {/* Filter Tabs */}
        <div className="filter-tabs">
          <button 
            className={`filter-tab ${activeFilter === 'search' ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter('search');
              setFilterValue('');
              setFilteredList([]);
            }}
          >
            🔍 शोध
          </button>
          <button 
            className={`filter-tab ${activeFilter === 'booth' ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter('booth');
              setFilterValue('');
              setFilteredList([]);
            }}
          >
            🏛️ बूथ वार
          </button>
          <button 
            className={`filter-tab ${activeFilter === 'surname' ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter('surname');
              setFilterValue('');
              setFilteredList([]);
            }}
          >
            👤 उपनाव वार
          </button>
          <button 
            className={`filter-tab ${activeFilter === 'address' ? 'active' : ''}`}
            onClick={() => {
              setActiveFilter('address');
              setFilterValue('');
              setFilteredList([]);
            }}
          >
            📍 पत्ता वार
          </button>
        </div>

        {/* Search Section - New Design */}
        {activeFilter === 'search' && (
        <div className="search-section">
          <div className="search-container">
            <div className="search-box">
              <div className="search-icon-wrapper">
                <FaSearch className="search-icon" />
              </div>
              <div className="search-mode-chips">
                <button
                  type="button"
                  className={`search-mode-chip ${searchMode === 'all' ? 'active' : ''}`}
                  onClick={() => setSearchMode('all')}
                >
                  सर्व
                </button>
                <button
                  type="button"
                  className={`search-mode-chip ${searchMode === 'name' ? 'active' : ''}`}
                  onClick={() => setSearchMode('name')}
                >
                  नाव
                </button>
                <button
                  type="button"
                  className={`search-mode-chip ${searchMode === 'epic' ? 'active' : ''}`}
                  onClick={() => setSearchMode('epic')}
                >
                  EPIC
                </button>
                <button
                  type="button"
                  className={`search-mode-chip ${searchMode === 'mobile' ? 'active' : ''}`}
                  onClick={() => setSearchMode('mobile')}
                >
                  मोबाईल
                </button>
              </div>
              <input
                type="text"
                className="search-input-new"
                placeholder={
                  searchMode === 'epic'
                    ? 'EPIC / मतदान कार्ड क्र. टाइप करा...'
                    : searchMode === 'mobile'
                    ? 'मोबाईल नं. टाइप करा...'
                    : searchMode === 'name'
                    ? 'नाव / उपनाव टाइप करा...'
                    : 'नाव, मतदान कार्ड क्र., मोबाईल नं. टाइप करा...'
                }
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => {
                  if (filteredVoters.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                autoComplete="off"
                spellCheck="false"
              />
              {isSearching && (
                <div className="search-loading-icon">
                  <FaSpinner className="spinner-small" />
                </div>
              )}
              {searchQuery && !isSearching && (
                <div
                  className="clear-icon"
                  onClick={handleClearSearch}
                  title="Clear search"
                >
                  <FaTimes />
                </div>
              )}
            </div>

            {/* Suggestions Dropdown - New Design */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions-container">
                <div className="suggestions-header">
                  <span>{suggestions.length} सुझाव</span>
                </div>
                <div className="suggestions-list">
                  {suggestions.map((voter, index) => {
                    const nameEn = (voter.name || voter.FM_NAME_EN || '').trim();
                    const nameMr = (voter.name_mr || voter.FM_NAME_V1 || '').trim();
                    const lastNameEn = (voter.LASTNAME_EN || '').trim();
                    const lastNameMr = (voter.LASTNAME_V1 || '').trim();
                    
                    // Check if lastname is already in the name to avoid duplication
                    let fullNameEn = nameEn;
                    if (lastNameEn && !nameEn.toLowerCase().includes(lastNameEn.toLowerCase())) {
                      fullNameEn = `${nameEn} ${lastNameEn}`.trim();
                    }
                    
                    let fullNameMr = nameMr;
                    if (lastNameMr && !nameMr.includes(lastNameMr)) {
                      fullNameMr = `${nameMr} ${lastNameMr}`.trim();
                    }
                    
                    const displayName = fullNameMr || fullNameEn || nameEn || nameMr || 'N/A';

                    return (
                      <div
                        key={`${voter._id || 'voter'}-${index}`}
                        className="suggestion-card"
                        onClick={() => handleSuggestionClick(voter)}
                      >
                        <div className="suggestion-content">
                          <div className="suggestion-name-new">{displayName}</div>
                          {voter.voterIdCard || voter.EPIC_NO ? (
                            <div className="suggestion-id-new">
                              <span className="id-label">ID:</span> {voter.voterIdCard || voter.EPIC_NO}
                            </div>
                          ) : null}
                          {voter.mobileNumber && (
                            <div className="suggestion-mobile">
                              <span className="mobile-label">Mobile:</span> {voter.mobileNumber}
                            </div>
                          )}
                        </div>
                        <div className="suggestion-arrow">
                          →
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* Booth Filter Section */}
        {activeFilter === 'booth' && (
          <div className="filter-section">
            <div className="filter-input-container">
              <label>बूथ नंबर / यादी भाग / POLLING CENTER:</label>
              <input
                type="text"
                className="filter-input"
                placeholder="बूथ नंबर टाइप करा..."
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                list="booth-list"
              />
              <datalist id="booth-list">
                {uniqueBooths.slice(0, 50).map((booth, idx) => (
                  <option key={idx} value={booth} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        {/* Surname Filter Section */}
        {activeFilter === 'surname' && (
          <div className="filter-section">
            <div className="filter-input-container">
              <label>उपनाव टाइप करा:</label>
              <input
                type="text"
                className="filter-input"
                placeholder="उपनाव टाइप करा..."
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                list="surname-list"
              />
              <datalist id="surname-list">
                {uniqueSurnames.slice(0, 100).map((surname, idx) => (
                  <option key={idx} value={surname} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        {/* Address Filter Section */}
        {activeFilter === 'address' && (
          <div className="filter-section">
            <div className="filter-input-container">
              <label>पत्ता टाइप करा:</label>
              <input
                type="text"
                className="filter-input"
                placeholder="पत्ता, घर क्र., क्षेत्र टाइप करा..."
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Filtered Results Cards View */}
        {activeFilter !== 'search' && filteredList.length > 0 && (
          <div className="filtered-results-section">
            <div className="results-header">
              <h3>
                {activeFilter === 'booth' && '🏛️ बूथ वार मतदार'}
                {activeFilter === 'surname' && '👤 उपनाव वार मतदार'}
                {activeFilter === 'address' && '📍 पत्ता वार मतदार'}
              </h3>
              <span className="results-count">{filteredList.length} मतदार सापडले</span>
            </div>
              <div className="voter-cards-grid">
              {filteredList.map((voter, index) => {
                const nameEn = (voter.name || voter.FM_NAME_EN || '').trim();
                const nameMr = (voter.name_mr || voter.FM_NAME_V1 || '').trim();
                const lastNameEn = (voter.LASTNAME_EN || '').trim();
                const lastNameMr = (voter.LASTNAME_V1 || '').trim();
                
                // Check if lastname is already in the name to avoid duplication
                let fullNameEn = nameEn;
                if (lastNameEn && !nameEn.toLowerCase().includes(lastNameEn.toLowerCase())) {
                  fullNameEn = `${nameEn} ${lastNameEn}`.trim();
                }
                
                let fullNameMr = nameMr;
                if (lastNameMr && !nameMr.includes(lastNameMr)) {
                  fullNameMr = `${nameMr} ${lastNameMr}`.trim();
                }
                
                const displayName = fullNameMr || fullNameEn || nameEn || nameMr || 'N/A';

                return (
                  <div key={`${voter._id || 'filtered'}-${index}`} className="voter-card">
                    <div className="voter-card-header">
                      <div className="voter-card-name">{displayName}</div>
                      {fullNameEn && fullNameMr && fullNameEn !== fullNameMr && (
                        <div className="voter-card-name-en">{fullNameEn}</div>
                      )}
                    </div>
                    <div className="voter-card-body">
                      {voter.voterIdCard || voter.EPIC_NO ? (
                        <div className="voter-card-item">
                          <span className="card-label">मतदान कार्ड:</span>
                          <span className="card-value">{voter.voterIdCard || voter.EPIC_NO}</span>
                        </div>
                      ) : null}
                      {voter.mobileNumber && (
                        <div className="voter-card-item">
                          <span className="card-label">मोबाईल:</span>
                          <span className="card-value">{voter.mobileNumber}</span>
                        </div>
                      )}
                      {voter.PART_NO && (
                        <div className="voter-card-item">
                          <span className="card-label">यादी भाग:</span>
                          <span className="card-value">{voter.PART_NO}</span>
                        </div>
                      )}
                      {voter.houseNumber || voter.C_HOUSE_NO ? (
                        <div className="voter-card-item">
                          <span className="card-label">घर क्र.:</span>
                          <span className="card-value">{voter.houseNumber || voter.C_HOUSE_NO}</span>
                        </div>
                      ) : null}
                      {(voter.adr1 || voter.adr2) && (
                        <div className="voter-card-item">
                          <span className="card-label">पत्ता:</span>
                          <span className="card-value">{voter.adr2 || voter.adr1 || '-'}</span>
                        </div>
                      )}
                      <button
                        className="card-view-btn"
                        onClick={() => handleVoterClick(voter)}
                      >
                        <FaEye /> सर्व तपशील पहा
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Loading - Only show if no data loaded yet */}
        {loading && voters.length === 0 && (
          <div className="loading">
            <FaSpinner className="spinner" />
            <p>
              {isRetrying 
                ? `पुनः प्रयास कर रहे हैं... (${retryCount}/3)`
                : 'डेटा लोड होत आहे...'}
            </p>
            {error && !error.includes('Loading...') && (
              <p className="retry-message">{error}</p>
            )}
          </div>
        )}

        {/* Total Voters Count */}
        {!loading && !error && (voters.length > 0 || totalCount > 0) && (
          <div className="total-voters-info">
            <div className="total-voters-card">
              <h3>कुल मतदार</h3>
              <p className="total-count">{(totalCount || voters.length).toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Error with Retry */}
        {!loading && voters.length === 0 && (
          <div className="error-retry">
            <div className="error-icon">⚠️</div>
            <h3>डेटा लोड नहीं हो पाया</h3>
            <p>कृपया पुनः प्रयास करें या कुछ समय बाद refresh करें</p>
            <p className="error-hint">💡 Browser console में error details देखें (F12 दबाएं)</p>
            <button className="retry-btn" onClick={handleRetry} disabled={loading}>
              <FaRedo /> पुनः प्रयास करें
            </button>
            <div className="error-tips">
              <h4>समस्या निवारण:</h4>
              <ul>
                <li>Internet connection जांचें</li>
                <li>Browser refresh करें (Ctrl+R / Cmd+R)</li>
                <li>कुछ समय बाद पुनः प्रयास करें</li>
                <li>Browser console (F12) में error देखें</li>
              </ul>
            </div>
          </div>
        )}

        {/* Results - Only show when suggestions are hidden and results are few */}
        {!loading && !error && voters.length > 0 && searchQuery && searchQuery.trim() && !showSuggestions && displayVoters.length > 0 && displayVoters.length <= 10 && (
          <div className="results-section">
                <div className="search-info">
              <span>
                {displayVoters.length} परिणाम सापडले
              </span>
                </div>

                {/* Desktop Table */}
                <div className="table-wrapper">
                  <table className="voter-table">
                    <thead>
                      <tr>
                        <th>नाव (मराठी)</th>
                        <th>नाव (इंग्रजी)</th>
                        <th>मतदान कार्ड क्र.</th>
                        <th>मोबाईल नं.</th>
                        <th>क्रिया</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayVoters.map((voter, index) => (
                        <tr key={`${voter._id || 'row'}-${index}`}>
                          <td>{voter.name_mr || voter.FM_NAME_V1 || '-'}</td>
                          <td>{voter.name || voter.FM_NAME_EN || '-'}</td>
                          <td>{voter.voterIdCard || voter.EPIC_NO || '-'}</td>
                          <td>{voter.mobileNumber || '-'}</td>
                          <td>
                            <button
                              className="view-btn"
                              onClick={() => handleVoterClick(voter)}
                            >
                              <FaEye /> पहा
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards View */}
                <div className="mobile-cards-view">
                  {displayVoters.map((voter, index) => (
                    <div key={`${voter._id || 'mobile'}-${index}`} className="voter-card-mobile">
                      <div className="voter-card-mobile-header">
                        <div className="voter-card-mobile-name">
                          {voter.name_mr || voter.FM_NAME_V1 || voter.name || voter.FM_NAME_EN || 'N/A'}
                        </div>
                        {(voter.name || voter.FM_NAME_EN) && (voter.name_mr || voter.FM_NAME_V1) && (
                          <div className="voter-card-mobile-name-en">
                            {voter.name || voter.FM_NAME_EN}
                          </div>
                        )}
                      </div>
                      <div className="voter-card-mobile-body">
                        <div className="voter-card-mobile-item">
                          <span className="voter-card-mobile-label">मतदान कार्ड क्र.:</span>
                          <span className="voter-card-mobile-value">
                            {voter.voterIdCard || voter.EPIC_NO || '-'}
                          </span>
                        </div>
                        {voter.mobileNumber && (
                          <div className="voter-card-mobile-item">
                            <span className="voter-card-mobile-label">मोबाईल नं.:</span>
                            <span className="voter-card-mobile-value">{voter.mobileNumber}</span>
                          </div>
                        )}
                        <button
                          className="view-btn view-btn-mobile"
                          onClick={() => handleVoterClick(voter)}
                        >
                          <FaEye /> सर्व तपशील पहा
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
          </div>
        )}

        {/* Show hint when many results but suggestions hidden */}
        {!loading && !error && voters.length > 0 && searchQuery && searchQuery.trim() && !showSuggestions && displayVoters.length > 10 && (
          <div className="search-hint-message">
            <p>कृपया शोध पट्टीमध्ये टाइप करून विशिष्ट मतदार शोधा</p>
            <p className="hint-small">किंवा सुझाव ड्रॉपडाउनमधून निवडा</p>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showModal && selectedVoter && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>संपूर्ण मतदार माहिती</h3>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
              >
                <FaTimes />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <h4>📌 मूलभूत माहिती</h4>
                <div className="detail-grid">
                  <div>
                    <strong>नाव (इंग्रजी):</strong>{' '}
                    {selectedVoter.name || selectedVoter.FM_NAME_EN || '-'}
                  </div>
                  <div>
                    <strong>नाव (मराठी):</strong>{' '}
                    {selectedVoter.name_mr || selectedVoter.FM_NAME_V1 || '-'}
                  </div>
                  <div>
                    <strong>उपनाव (इंग्रजी):</strong>{' '}
                    {selectedVoter.LASTNAME_EN || '-'}
                  </div>
                  <div>
                    <strong>उपनाव (मराठी):</strong>{' '}
                    {selectedVoter.LASTNAME_V1 || '-'}
                  </div>
                  <div>
                    <strong>वय:</strong> {selectedVoter.age || '-'}
                  </div>
                  <div>
                    <strong>लिंग:</strong>{' '}
                    {selectedVoter.gender || selectedVoter.gender_mr || '-'}
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>🪪 मतदान कार्ड माहिती</h4>
                <div className="detail-grid">
                  <div>
                    <strong>मतदान कार्ड क्र.:</strong>{' '}
                    {selectedVoter.voterIdCard || selectedVoter.EPIC_NO || '-'}
                  </div>
                  <div>
                    <strong>EPIC NO:</strong> {selectedVoter.EPIC_NO || '-'}
                  </div>
                  <div>
                    <strong>विधानसभा:</strong> {selectedVoter.AC_NO || '-'}
                  </div>
                  <div>
                    <strong>यादी भाग:</strong> {selectedVoter.PART_NO || '-'}
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>📍 पत्ता</h4>
                <div className="detail-grid">
                  <div>
                    <strong>पत्ता (इंग्रजी):</strong> {selectedVoter.adr1 || '-'}
                  </div>
                  <div>
                    <strong>पत्ता (मराठी):</strong> {selectedVoter.adr2 || '-'}
                  </div>
                  <div>
                    <strong>घर क्र.:</strong>{' '}
                    {selectedVoter.houseNumber ||
                      selectedVoter.C_HOUSE_NO ||
                      '-'}
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <h4>📞 संपर्क माहिती</h4>
                <div className="detail-grid">
                  <div>
                    <strong>मोबाईल नं.:</strong>{' '}
                    {selectedVoter.mobileNumber || '-'}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="close-btn whatsapp-btn"
                onClick={handleShareOnWhatsApp}
              >
                <FaWhatsapp /> WhatsApp वर पाठवा
              </button>
              <button
                className="close-btn"
                onClick={() => setShowModal(false)}
              >
                बंद करा
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

