import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import COLORS from '@/assets/colors';
import TYPOGRAPHY from '@/assets/typography';
import { TokenInfo, useTokenSearch } from '@/modules/dataModule';

const { height } = Dimensions.get('window');

// Styles specific to this modal
const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.lightBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 48 : 24,
    maxHeight: height * 0.8,
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.borderDarkColor,
    borderBottomWidth: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.size.xl,
    fontWeight: String(TYPOGRAPHY.bold) as any,
    color: COLORS.white,
  },
  modalCloseButton: {
    padding: 8,
  },
  modalCloseText: {
    fontSize: 20,
    color: COLORS.white,
    fontWeight: String(TYPOGRAPHY.medium) as any,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.darkerBackground,
    marginHorizontal: 24,
    marginBottom: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderDarkColor,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: TYPOGRAPHY.size.md,
    color: COLORS.white,
    padding: 0,
  },
  listContentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  tokenItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDarkColor,
  },
  tokenItemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tokenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.darkerBackground,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tokenTextContainer: {
    marginLeft: 16,
    flex: 1,
  },
  tokenSymbol: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: String(TYPOGRAPHY.bold) as any,
    color: COLORS.white,
  },
  tokenName: {
    fontSize: TYPOGRAPHY.size.sm,
    color: COLORS.greyMid,
    marginTop: 2,
  },
  tokenStats: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tokenPrice: {
    fontSize: TYPOGRAPHY.size.xs,
    color: COLORS.greyLight,
  },
  tokenChange: {
    fontSize: TYPOGRAPHY.size.xs,
    marginLeft: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  loadingContainer: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: TYPOGRAPHY.size.md,
    color: COLORS.greyMid,
  },
  emptyContainer: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: TYPOGRAPHY.size.md,
    color: COLORS.greyMid,
    textAlign: 'center',
  },
  closeButton: {
    marginHorizontal: 24,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.darkerBackground,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderDarkColor,
  },
  closeButtonText: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: String(TYPOGRAPHY.medium) as any,
    color: COLORS.white,
  },
  loadingFooter: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface SelectTokenModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Callback fired when the modal is closed */
  onClose: () => void;
  /** Callback fired when a token is selected */
  onTokenSelected: (token: TokenInfo) => void;
}

export default function SelectTokenModal({
  visible,
  onClose,
  onTokenSelected,
}: SelectTokenModalProps) {
  // Use the new token search hook with debounce
  const {
    tokens: rawTokens,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    loadMore,
    refresh
  } = useTokenSearch('', 300);

  // State for deduplicated tokens
  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  // Deduplicate tokens when rawTokens change
  useEffect(() => {
    // Use a Map to keep only the first occurrence of each token address
    const uniqueTokensMap = new Map<string, TokenInfo>();

    rawTokens.forEach(token => {
      if (!uniqueTokensMap.has(token.address)) {
        uniqueTokensMap.set(token.address, token);
      }
    });

    // Convert Map values back to array
    setTokens(Array.from(uniqueTokensMap.values()));
  }, [rawTokens]);

  // Keep track of whether the component is mounted and user's input
  const isMounted = useRef(true);
  const hasUserSearched = useRef(false);

  // Add a unique index map for handling duplicate tokens (as backup)
  const uniqueTokens = useRef(new Map());

  // Reset search ONLY when modal initially becomes visible
  useEffect(() => {
    if (visible && !hasUserSearched.current) {
      setSearchQuery('');
      refresh();
    }

    // When modal becomes invisible, reset the search flag and clear uniqueTokens map
    if (!visible) {
      hasUserSearched.current = false;
      uniqueTokens.current.clear();
    }
  }, [visible, refresh, setSearchQuery]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  /**
   * Handles search input changes
   */
  const handleSearchChange = (text: string) => {
    hasUserSearched.current = true; // Mark that user has started searching
    setSearchQuery(text);
  };

  /**
   * Handles end of list reached to load more tokens
   */
  const handleEndReached = () => {
    if (!loading && rawTokens.length > 0) {
      loadMore();
    }
  };

  /**
   * Renders a single token item in the list
   */
  const renderItem = ({ item }: { item: TokenInfo }) => (
    <TouchableOpacity
      style={styles.tokenItem}
      onPress={() => onTokenSelected(item)}
      activeOpacity={0.7}
    >
      <View style={styles.tokenItemContent}>
        {item.logoURI ? (
          <Image
            source={{ uri: item.logoURI }}
            style={styles.tokenLogo}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.tokenLogo}>
            <Text style={{ color: COLORS.white, fontWeight: '600', fontSize: 12 }}>
              {item.symbol && typeof item.symbol === 'string' ? item.symbol.charAt(0) : '?'}
            </Text>
          </View>
        )}
        <View style={styles.tokenTextContainer}>
          <Text style={styles.tokenSymbol} numberOfLines={1} ellipsizeMode="tail">
            {item.symbol || 'Unknown'}
          </Text>
          <Text style={styles.tokenName} numberOfLines={1} ellipsizeMode="tail">
            {item.name || 'Unknown Token'}
          </Text>
          <View style={styles.tokenStats}>
            {item.price !== undefined && item.price !== null && (
              <Text style={styles.tokenPrice}>
                ${item.price.toFixed(item.price < 0.01 ? 6 : 2)}
              </Text>
            )}
            {item.priceChange24h !== undefined && item.priceChange24h !== null && (
              <Text
                style={[
                  styles.tokenChange,
                  {
                    backgroundColor: item.priceChange24h >= 0 ? 'rgba(0, 200, 83, 0.2)' : 'rgba(255, 45, 85, 0.2)',
                    color: item.priceChange24h >= 0 ? '#00C853' : '#FF2D55'
                  }
                ]}
              >
                {item.priceChange24h >= 0 ? '+' : ''}{item.priceChange24h.toFixed(2)}%
              </Text>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  /**
   * Renders a loading indicator at the bottom when loading more tokens
   */
  const renderFooter = () => {
    if (!loading) return null;

    return (
      <View style={styles.loadingFooter}>
        <ActivityIndicator size="small" color={COLORS.brandPrimary} />
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalOverlay} />
      </TouchableWithoutFeedback>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select a Token</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={onClose}
            >
              <Ionicons name="close" size={24} color={COLORS.white} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <FontAwesome5 name="search" size={16} color={COLORS.greyMid} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, symbol, or address"
              placeholderTextColor={COLORS.greyMid}
              value={searchQuery}
              onChangeText={handleSearchChange}
              clearButtonMode="while-editing"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => handleSearchChange('')}>
                <Ionicons name="close-circle" size={18} color={COLORS.greyMid} style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            )}
          </View>

          {!tokens.length && loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator
                size="large"
                color={COLORS.brandPrimary}
              />
              <Text style={styles.loadingText}>Loading tokens...</Text>
            </View>
          ) : (
            <>
              <FlatList
                data={tokens}
                keyExtractor={(item) => item.address}
                renderItem={renderItem}
                contentContainerStyle={styles.listContentContainer}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.5}
                refreshing={loading && tokens.length === 0}
                onRefresh={refresh}
                ListFooterComponent={renderFooter}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text style={styles.emptyText}>
                      {error ? `Error: ${error}` :
                        searchQuery ? `No tokens found matching "${searchQuery}"` :
                          'No tokens available'}
                    </Text>
                    {error && (
                      <TouchableOpacity
                        style={{ marginTop: 12, padding: 8 }}
                        onPress={refresh}
                      >
                        <Text style={{ color: COLORS.brandPrimary }}>Try Again</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                }
              />

              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
              >
                <Text style={styles.closeButtonText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
} 