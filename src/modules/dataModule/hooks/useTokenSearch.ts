import { useState, useEffect, useCallback, useMemo } from 'react';
import { TokenInfo } from '../types/tokenTypes';
import { fetchTokenList, searchTokens, TokenSearchParams, TokenListParams } from '../services/tokenService';

interface UseTokenSearchResult {
  tokens: TokenInfo[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Hook for searching and listing tokens with debounce functionality
 */
export function useTokenSearch(
  initialQuery: string = '', 
  debounceMs: number = 300
): UseTokenSearchResult {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(true);
  
  // Setup debounce mechanism for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      // Reset pagination when query changes
      setOffset(0);
      setHasMore(true);
    }, debounceMs);
    
    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery, debounceMs]);
  
  // Function to fetch tokens based on search query
  const fetchTokens = useCallback(async (isLoadingMore: boolean = false) => {
    try {
      setLoading(true);
      setError(null);
      
      let result: TokenInfo[] = [];
      
      if (debouncedQuery.trim() === '') {
        // If no search query, fetch top tokens sorted by market cap
        const params: TokenListParams = {
          sort_by: 'market_cap',
          sort_type: 'desc',
          offset: isLoadingMore ? offset : 0,
          limit: 20
        };
        
        result = await fetchTokenList(params);
      } else {
        // If we have a search query, use the search API
        const params: TokenSearchParams = {
          keyword: debouncedQuery,
          sort_by: 'volume_24h_usd',
          sort_type: 'desc',
          offset: isLoadingMore ? offset : 0,
          limit: 20
        };
        
        result = await searchTokens(params);
      }
      
      // Filter out tokens with invalid or missing required properties
      const validTokens = result.filter(token => 
        token && 
        token.address && 
        (token.symbol !== null && token.symbol !== undefined) &&
        (token.name !== null && token.name !== undefined) &&
        (token.decimals !== null && token.decimals !== undefined)
      );
      
      if (validTokens.length === 0) {
        setHasMore(false);
      }
      
      // If loading more, append to current list; otherwise replace
      setTokens(prev => isLoadingMore ? [...prev, ...validTokens] : validTokens);
      
      // Update offset for pagination
      if (isLoadingMore) {
        setOffset(prev => prev + 20);
      }
    } catch (err) {
      console.error('Error in useTokenSearch:', err);
      setError('Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, offset]);
  
  // Fetch tokens when debounced query changes
  useEffect(() => {
    fetchTokens();
  }, [debouncedQuery, fetchTokens]);
  
  // Load more tokens (pagination)
  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchTokens(true);
    }
  }, [loading, hasMore, fetchTokens]);
  
  // Refresh the token list
  const refresh = useCallback(() => {
    setOffset(0);
    setHasMore(true);
    fetchTokens();
  }, [fetchTokens]);
  
  return useMemo(() => ({
    tokens,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    loadMore,
    refresh
  }), [tokens, loading, error, searchQuery, loadMore, refresh]);
} 