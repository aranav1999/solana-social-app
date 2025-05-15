// File: src/screens/SampleUI/Threads/FeedScreen/FeedScreen.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, Platform, View, FlatList, StatusBar } from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Thread } from '@/core/thread/components/thread-container/Thread';
import {
  ThreadUser,
  ThreadPost,
  ThreadCTAButton,
} from '@/core/thread/components/thread.types';
import { useAppDispatch, useAppSelector } from '@/shared/hooks/useReduxHooks';
import { fetchAllPosts } from '@/shared/state/thread/reducer';
import { fetchUserProfile } from '@/shared/state/auth/reducer';
import COLORS from '@/assets/colors';
import { RootStackParamList } from '@/shared/navigation/RootNavigator';
import { DEFAULT_IMAGES } from '@/config/constants';
import HomeEnvErrorBanner from '@/core/sharedUI/EnvErrors/HomeEnvErrorBanner';
import FeedItemSkeleton from '@/core/feed/components/FeedSkeleton';

/**
 * FeedScreen component that displays user's social feed
 * Includes wallet navigation functionality
 */
export default function FeedScreen() {
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const allPosts = useAppSelector(state => state.thread.allPosts);
  const userWallet = useAppSelector(state => state.auth.address);
  const storedProfilePic = useAppSelector(state => state.auth.profilePicUrl);
  const userName = useAppSelector(state => state.auth.username);
  const isLoggedIn = useAppSelector(state => state.auth.isLoggedIn);

  const [feedPosts, setFeedPosts] = useState<ThreadPost[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileStable, setProfileStable] = useState(false);
  const [areInitialPostsLoading, setAreInitialPostsLoading] = useState(true);

  // Build current user object from Redux data
  const currentUser: ThreadUser = {
    id: userWallet || 'anonymous-user',
    username: userName || 'Anonymous',
    handle: userWallet
      ? '@' + userWallet.slice(0, 6) + '...' + userWallet.slice(-4)
      : '@anonymous',
    verified: true,
    avatar: storedProfilePic ? { uri: storedProfilePic } : DEFAULT_IMAGES.user,
  };

  // On mount, fetch all posts and set loading state for initial posts
  useEffect(() => {
    const initialFetchPosts = async () => {
      try {
        await dispatch(fetchAllPosts()).unwrap();
      } catch (error) {
        console.error("Failed to fetch initial posts:", error);
      } finally {
        setAreInitialPostsLoading(false);
      }
    };
    initialFetchPosts();
  }, [dispatch]);

  // Once we have userWallet, fetch DB profile info (username, profile pic)
  // Only fetch when properly authenticated with isLoggedIn true
  useEffect(() => {
    const loadProfile = async () => {
      if (userWallet && isLoggedIn) {
        try {
          setIsProfileLoading(true);
          await dispatch(fetchUserProfile(userWallet)).unwrap();
          // Set a small delay to ensure no flickering when profile data arrives
          setTimeout(() => {
            setProfileStable(true);
            setIsProfileLoading(false);
          }, 500);
        } catch (err) {
          console.error('Failed to fetch user profile:', err);
          setIsProfileLoading(false);
          setProfileStable(true); // Consider profile stable even on error to show UI
        }
      } else if (!isLoggedIn) {
        // Reset profile stable if not logged in
        setProfileStable(false);
      }
    };

    loadProfile();
  }, [userWallet, isLoggedIn, dispatch]);

  // We now include both root posts AND replies in the feed
  useEffect(() => {
    const sortedAll = [...allPosts];
    // Sort descending by createdAt
    sortedAll.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    setFeedPosts(sortedAll);
  }, [allPosts]);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await dispatch(fetchAllPosts());
    setRefreshing(false);
  }, [dispatch]);

  // Example CTA buttons (completely optional)
  const ctaButtons: ThreadCTAButton[] = [
    {
      label: 'Mint NFT',
      onPress: post => console.log('Mint NFT pressed for post:', post.id),
      buttonStyle: {
        backgroundColor: '#2A2A2A',
        width: 130,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
      },
      buttonLabelStyle: { color: '#FFFFFF' },
    },
    {
      label: 'Trade',
      onPress: post => console.log('Trade pressed for post:', post.id),
      buttonStyle: {
        backgroundColor: '#2A2A2A',
        width: 140,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
      },
      buttonLabelStyle: { color: '#FFFFFF' },
    },
  ];

  // Show skeleton until profile is stable AND initial posts are loaded
  if (!profileStable || areInitialPostsLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar backgroundColor={COLORS.background} barStyle="light-content" />
        <View style={[
          Platform.OS === 'android' && {
            paddingTop: insets.top
          }
        ]}>
          <FlatList
            data={[1, 2, 3]}
            keyExtractor={(item) => item.toString()}
            renderItem={() => <FeedItemSkeleton />}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Custom header render function with environment error banner
  const renderCustomHeader = () => {
    return (
      <View>
        <HomeEnvErrorBanner />
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        Platform.OS === 'android' && {
          paddingTop: insets.top
        }
      ]}>
      <StatusBar backgroundColor={COLORS.background} barStyle="light-content" />
      {renderCustomHeader()}
      <Thread
        rootPosts={feedPosts} // Passing all posts (including replies)
        currentUser={currentUser}
        ctaButtons={ctaButtons}
        // Set disableReplies to false so that replies render with their parent snippet.
        disableReplies={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        // onPressPost navigates to the PostThreadScreen with the post's ID.
        onPressPost={post => {
          // For retweets and quotes, handle navigation correctly:
          if (post.retweetOf) {
            // If this is a retweet with no content (direct retweet), navigate to the original
            if (post.sections.length === 0) {
              navigation.navigate('PostThread', { postId: post.retweetOf.id });
            } else {
              // If it's a quote retweet, navigate to the quote itself
              navigation.navigate('PostThread', { postId: post.id });
            }
          } else {
            // Regular post
            navigation.navigate('PostThread', { postId: post.id });
          }
        }}
        themeOverrides={{
          '--thread-bg-primary': COLORS.background,
          '--retweet-border-color': COLORS.borderDarkColor,
          '--retweet-bg-color': COLORS.lighterBackground,
          '--retweet-text-color': COLORS.greyMid
        }}
        styleOverrides={{
          container: { padding: 6 },
          button: { borderRadius: 8 },
          buttonLabel: { fontWeight: 'bold' },
          retweetHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 6,
            paddingLeft: 6,
            paddingTop: 4,
          },
          retweetHeaderText: {
            fontSize: 13,
            color: COLORS.greyMid,
            marginLeft: 6,
            fontWeight: '500',
          },
          retweetedContent: {
            marginTop: 4,
            width: '100%',
          },
          originalPostContainer: {
            width: '100%',
            borderRadius: 12,
            backgroundColor: COLORS.lighterBackground,
            padding: 10,
            borderWidth: 1,
            borderColor: COLORS.borderDarkColor,
          },
        }}
        onPressUser={user => {
          // Check if the tapped user is the current (logged-in) user
          if (user.id === currentUser.id) {
            navigation.navigate('ProfileScreen' as never); // Show own profile
          } else {
            navigation.navigate('OtherProfile', { userId: user.id }); // Show other profile
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
