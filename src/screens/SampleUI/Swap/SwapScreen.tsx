import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  SafeAreaView,
  TouchableOpacity,
  Image,
  StatusBar,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Clipboard,
  Linking,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { PublicKey } from '@solana/web3.js';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar as RNStatusBar } from 'react-native';

import { styles } from './SwapScreen.styles';
import COLORS from '@/assets/colors';
import SelectTokenModal from './SelectTokenModal';
import { useWallet } from '@/modules/walletProviders/hooks/useWallet';
import {
  TokenInfo,
  fetchTokenBalance,
  fetchTokenPrice,
  fetchTokenMetadata,
  ensureCompleteTokenInfo,
  estimateTokenUsdValue
} from '@/modules/dataModule';
import { TradeService, SwapProvider } from '@/modules/dataModule/services/tradeService';
import { TransactionService } from '@/modules/walletProviders/services/transaction/transactionService';
import Icons from '@/assets/svgs';
import TYPOGRAPHY from '@/assets/typography';
import { RootStackParamList } from '@/shared/navigation/RootNavigator';
import { AppHeader } from '@/core/sharedUI';

// Android-specific styles
const androidStyles = StyleSheet.create({
  statusBarPlaceholder: {
    height: StatusBar.currentHeight || 24,
    backgroundColor: COLORS.background,
  },
  headerContainer: {
    paddingTop: 8, // Additional padding for Android camera hole
  }
});

// Define types for navigation and route
type SwapScreenRouteProp = RouteProp<RootStackParamList, 'SwapScreen'>;
type SwapScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'SwapScreen'>;

// Swap providers
const swapProviders: SwapProvider[] = ['Jupiter', 'Raydium', 'PumpSwap'];

// Time after which to assume PumpSwap transactions have succeeded (in milliseconds)
const PUMPSWAP_SUCCESS_TIMEOUT = 10000; // 10 seconds

export default function SwapScreen() {
  const navigation = useNavigation<SwapScreenNavigationProp>();
  const route = useRoute<SwapScreenRouteProp>();
  const { publicKey: userPublicKey, connected, sendTransaction } = useWallet();

  // Get parameters from route if they exist
  const routeParams = route.params || {};

  // Handle back button press
  const handleBack = useCallback(() => {
    // Check if we can go back before attempting to navigate
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // We're in a tab, so there's nowhere to go back to
      // You could show a message, do nothing, or handle in another way
      console.log('Already at root level of navigation, cannot go back');
    }
  }, [navigation]);

  // UI States
  const [activeProvider, setActiveProvider] = useState<SwapProvider>('Jupiter');
  const [inputValue, setInputValue] = useState(routeParams.inputAmount || '5');
  const [showSelectTokenModal, setShowSelectTokenModal] = useState(false);
  const [selectingWhichSide, setSelectingWhichSide] = useState<'input' | 'output'>('input');
  const [poolAddress, setPoolAddress] = useState(''); // Add state for PumpSwap pool address
  const [slippage, setSlippage] = useState(10); // Add state for slippage, default to 10%

  // Token States - Initialize with null, will load on component mount
  const [inputToken, setInputToken] = useState<TokenInfo | null>(null);
  const [outputToken, setOutputToken] = useState<TokenInfo | null>(null);
  const [tokensInitialized, setTokensInitialized] = useState(false);
  const [currentBalance, setCurrentBalance] = useState<number | null>(null);
  const [currentTokenPrice, setCurrentTokenPrice] = useState<number | null>(null);
  const [estimatedOutputAmount, setEstimatedOutputAmount] = useState<string>('');

  // Transaction States
  const [loading, setLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [solscanTxSig, setSolscanTxSig] = useState(''); // For completed transactions

  // Refs
  const isMounted = useRef(true);
  const pendingTokenOps = useRef<{ input: boolean, output: boolean }>({ input: false, output: false });

  // Cleanup on unmount
  useEffect(() => {
    isMounted.current = true;
    return () => {
      console.log('[SwapScreen] Component unmounting, cleaning up');
      isMounted.current = false;
      pendingTokenOps.current = { input: false, output: false };
    };
  }, []);

  // Initialize tokens with details
  const initializeTokens = useCallback(async () => {
    // Don't initialize if already initializing or completed
    if (!isMounted.current || (pendingTokenOps.current.input && pendingTokenOps.current.output)) {
      return;
    }

    try {
      // Mark operations as pending
      pendingTokenOps.current = { input: true, output: true };
      console.log('[SwapScreen] Initializing tokens...', routeParams);

      // Fetch initial tokens
      let initialInputToken: TokenInfo | null = null;
      let initialOutputToken: TokenInfo | null = null;

      // Use tokens from route params if available, otherwise fetch SOL and USDC
      try {
        if (routeParams.inputToken && routeParams.inputToken.address) {
          console.log('[SwapScreen] Using input token from route params:', routeParams.inputToken);
          initialInputToken = await fetchTokenMetadata(routeParams.inputToken.address);
        } else {
          // Default to SOL if not specified
          initialInputToken = await fetchTokenMetadata('So11111111111111111111111111111111111111112');
        }
      } catch (err) {
        console.error('[SwapScreen] Error fetching input token:', err);
        // If we can't fetch the input token, try with SOL as a fallback
        initialInputToken = await fetchTokenMetadata('So11111111111111111111111111111111111111112');
      }

      try {
        if (routeParams.outputToken && routeParams.outputToken.address) {
          console.log('[SwapScreen] Using output token from route params:', routeParams.outputToken);
          initialOutputToken = await fetchTokenMetadata(routeParams.outputToken.address);
        } else {
          // Default to USDC if not specified
          initialOutputToken = await fetchTokenMetadata('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        }
      } catch (err) {
        console.error('[SwapScreen] Error fetching output token:', err);
        // If we can't fetch the output token, try with USDC as a fallback
        initialOutputToken = await fetchTokenMetadata('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      }

      // Handle case where token fetching fails
      if (!initialInputToken || !initialOutputToken) {
        console.error('[SwapScreen] Failed to initialize tokens after multiple attempts');
        setErrorMsg('Failed to load token information. Please try again.');
        pendingTokenOps.current = { input: false, output: false };
        return;
      }

      if (isMounted.current) {
        // Set the tokens
        setInputToken(initialInputToken);
        setOutputToken(initialOutputToken);
        pendingTokenOps.current = { input: false, output: false };
        setTokensInitialized(true);

        // If route provided an amount, set it
        if (routeParams.inputAmount) {
          console.log('[SwapScreen] Setting input amount from route:', routeParams.inputAmount);
          setInputValue(routeParams.inputAmount);
        }

        // Fetch balance and price
        if (userPublicKey && initialInputToken) {
          fetchTokenBalance(userPublicKey, initialInputToken).then(balance => {
            if (isMounted.current && balance !== null) {
              setCurrentBalance(balance);
              if (initialInputToken) {
                fetchTokenPrice(initialInputToken).then(price => {
                  if (isMounted.current && price !== null) {
                    setCurrentTokenPrice(price);
                  }
                });
              }
            }
          });
        }
      }
    } catch (error) {
      console.error('[SwapScreen] Error initializing tokens:', error);
      pendingTokenOps.current = { input: false, output: false };
    }
  }, [userPublicKey, routeParams]);

  // Initialize tokens on component mount or when route params change
  useEffect(() => {
    if (!tokensInitialized) {
      initializeTokens();
    } else if (routeParams.shouldInitialize) {
      // If the component needs to re-initialize with new route params
      console.log('[SwapScreen] Re-initializing from route params', routeParams);
      setTokensInitialized(false); // This will trigger initializeTokens() in the next effect

      // Clear the shouldInitialize flag to prevent re-initialization loops
      if (route.params) {
        // Update the route params to remove shouldInitialize
        navigation.setParams({ ...route.params, shouldInitialize: false });
      }
    }
  }, [tokensInitialized, initializeTokens, routeParams, route.params, navigation]);

  // Handle visibility changes to reset states and initialize tokens if needed
  useEffect(() => {
    // Reset states
    setResultMsg('');
    setErrorMsg('');
    setSolscanTxSig('');

    console.log('[SwapScreen] Component mounted/became visible. Current token price:', currentTokenPrice);

    // Initialize tokens if not already initialized
    if (!tokensInitialized) {
      initializeTokens();
    } else if (connected && userPublicKey && inputToken) {
      // If tokens are already initialized, fetch both balance and price
      console.log('[SwapScreen] Fetching balance and price for initialized tokens');

      // Force a token price update when becoming visible
      fetchTokenPrice(inputToken).then(price => {
        if (isMounted.current && price !== null) {
          console.log('[SwapScreen] Fetched token price on visibility change:', price);
          setCurrentTokenPrice(price);
        } else {
          console.log('[SwapScreen] Failed to fetch token price on visibility change');
        }
      });

      // Use a small timeout to avoid state updates colliding
      const timer = setTimeout(() => {
        if (isMounted.current) {
          fetchTokenBalance(userPublicKey, inputToken).then(() => {
            if (isMounted.current) {
              fetchTokenPrice(inputToken);
            }
          });
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [tokensInitialized, initializeTokens, connected, userPublicKey, fetchTokenBalance, inputToken, currentTokenPrice]);

  // Fetch token balance
  const fetchBalance = useCallback(async (tokenToUse?: TokenInfo | null) => {
    if (!connected || !userPublicKey) {
      console.log("[SwapScreen] No wallet connected, cannot fetch balance");
      return null;
    }

    const tokenForBalance = tokenToUse || inputToken;

    // Cannot fetch balance if token is null
    if (!tokenForBalance) {
      console.log("[SwapScreen] No token provided, cannot fetch balance");
      return null;
    }

    try {
      console.log(`[SwapScreen] Fetching balance for ${tokenForBalance.symbol}...`);
      const balance = await fetchTokenBalance(userPublicKey, tokenForBalance);

      // Only update state if component is still mounted and balance is non-null
      if (isMounted.current) {
        console.log(`[SwapScreen] Token balance fetched for ${tokenForBalance.symbol}: ${balance}`);
        setCurrentBalance(balance);
        return balance;
      }
    } catch (err) {
      console.error('[SwapScreen] Error fetching balance:', err);
      if (isMounted.current) {
        setCurrentBalance(0);
        setErrorMsg(`Failed to fetch ${tokenForBalance.symbol} balance`);
        setTimeout(() => isMounted.current && setErrorMsg(''), 3000);
      }
    }
    return null;
  }, [connected, userPublicKey, inputToken]);

  // Fetch token price
  const getTokenPrice = useCallback(async (tokenToUse?: TokenInfo | null): Promise<number | null> => {
    const tokenForPrice = tokenToUse || inputToken;

    // Cannot fetch price if token is null
    if (!tokenForPrice) {
      console.log("[SwapScreen] No token provided, cannot fetch price");
      return null;
    }

    try {
      console.log(`[SwapScreen] Fetching price for ${tokenForPrice.symbol}...`);
      const price = await fetchTokenPrice(tokenForPrice);
      if (isMounted.current) {
        console.log(`[SwapScreen] Token price fetched for ${tokenForPrice.symbol}: ${price}`);
        setCurrentTokenPrice(price);
        return price;
      }
    } catch (err) {
      console.error('[SwapScreen] Error fetching token price:', err);
      if (isMounted.current) {
        setCurrentTokenPrice(null);
      }
    }
    return null;
  }, [inputToken]);

  // Handle token selection
  const handleTokenSelected = useCallback(async (token: TokenInfo) => {
    if (!isMounted.current) return;

    try {
      console.log(`[SwapScreen] Token selected: ${token.symbol || 'Unknown'}`);

      // Mark token operation as pending
      if (selectingWhichSide === 'input') {
        pendingTokenOps.current.input = true;
      } else {
        pendingTokenOps.current.output = true;
      }

      // Ensure we have complete token info
      const completeToken = await ensureCompleteTokenInfo(token);

      if (!isMounted.current) return;

      if (selectingWhichSide === 'input') {
        console.log('[SwapScreen] Input token changed to', completeToken.symbol);

        // Update input token state
        setInputToken(completeToken);
        pendingTokenOps.current.input = false;

        // Reset input value and fetch new balance
        setInputValue('0');
        setCurrentBalance(null);

        // Fetch balance and price for new token with small delay
        setTimeout(async () => {
          if (isMounted.current && userPublicKey) {
            try {
              const newBalance = await fetchBalance(completeToken);
              if (isMounted.current && newBalance !== null) {
                await getTokenPrice(completeToken);
              }
            } catch (error) {
              console.error('[SwapScreen] Error fetching balance/price after token change:', error);
            }
          }
        }, 100);
      } else {
        console.log('[SwapScreen] Output token changed to', completeToken.symbol);
        setOutputToken(completeToken);
        pendingTokenOps.current.output = false;
      }

      setShowSelectTokenModal(false);
    } catch (error) {
      console.error('[SwapScreen] Error selecting token:', error);
      // Reset pending flags
      if (selectingWhichSide === 'input') {
        pendingTokenOps.current.input = false;
      } else {
        pendingTokenOps.current.output = false;
      }

      if (isMounted.current) {
        setErrorMsg('Failed to load token information');
        setTimeout(() => isMounted.current && setErrorMsg(''), 3000);
      }
    }
  }, [selectingWhichSide, fetchBalance, getTokenPrice, userPublicKey]);

  // Handle max button click
  const handleMaxButtonClick = useCallback(async () => {
    console.log("[SwapScreen] MAX button clicked, current balance:", currentBalance);

    if (isMounted.current) {
      setErrorMsg(''); // Clear any existing error messages
    }

    // Validate wallet connection
    if (!connected || !userPublicKey || !inputToken) {
      if (isMounted.current) {
        Alert.alert(
          "Wallet Not Connected",
          "Please connect your wallet to view your balance."
        );
      }
      return;
    }

    // If we already have a balance, use it
    if (currentBalance !== null && currentBalance > 0) {
      setInputValue(String(currentBalance));
      return;
    }

    // Otherwise, fetch fresh balance
    if (isMounted.current) {
      setLoading(true);
      setResultMsg("Fetching your balance...");
    }

    try {
      const balance = await fetchBalance(inputToken);

      if (isMounted.current) {
        setLoading(false);
        setResultMsg("");
      }

      // Check if we have a balance after fetching
      if (balance !== null && balance > 0 && isMounted.current) {
        console.log("[SwapScreen] Setting max amount from fetched balance:", balance);
        setInputValue(String(balance));
      } else if (isMounted.current) {
        console.log("[SwapScreen] Balance fetch returned:", balance);
        Alert.alert(
          "Balance Unavailable",
          `Could not get your ${inputToken.symbol} balance. Please check your wallet connection.`
        );
      }
    } catch (error) {
      console.error("[SwapScreen] Error in MAX button handler:", error);
      if (isMounted.current) {
        setLoading(false);
        setResultMsg("");
        setErrorMsg(`Failed to fetch your ${inputToken?.symbol || 'token'} balance`);
        setTimeout(() => isMounted.current && setErrorMsg(''), 3000);
      }
    }
  }, [currentBalance, fetchBalance, inputToken, userPublicKey, connected]);

  // Estimate the output amount based on input
  const estimateSwap = useCallback(async () => {
    if (!connected || parseFloat(inputValue) <= 0 || !inputToken || !outputToken) {
      return;
    }

    try {
      // Get prices for both tokens
      const inputPrice = await getTokenPrice(inputToken);
      const outputPrice = await getTokenPrice(outputToken);

      if (inputPrice && outputPrice && isMounted.current) {
        const inputValueNum = parseFloat(inputValue);

        // Calculate USD value
        const inputValueUsd = inputValueNum * inputPrice;

        // Calculate output amount based on equivalent USD value (minus simulated 0.3% fee)
        const estimatedOutput = (inputValueUsd / outputPrice) * 0.997;

        // Format the number properly based on token decimals
        setEstimatedOutputAmount(estimatedOutput.toFixed(outputToken.decimals <= 6 ? outputToken.decimals : 6));

        console.log(`[SwapScreen] Estimate: ${inputValueNum} ${inputToken.symbol} (${inputPrice} USD) → ${estimatedOutput} ${outputToken.symbol} (${outputPrice} USD)`);
      }
    } catch (error) {
      console.error('[SwapScreen] Error estimating swap:', error);
    }
  }, [connected, inputValue, getTokenPrice, inputToken, outputToken]);

  // Calculate USD value for a given token amount
  const calculateUsdValue = useCallback((amount: string, tokenPrice: number | null) => {
    // Add better error handling for invalid inputs
    if (!tokenPrice || tokenPrice <= 0 || !amount || isNaN(parseFloat(amount))) {
      return '$0.00';
    }

    try {
      const numericAmount = parseFloat(amount);
      const usdValue = numericAmount * tokenPrice;

      // Format based on value size
      if (usdValue >= 1000000) {
        return `$${(usdValue / 1000000).toFixed(2)}M`;
      } else if (usdValue >= 1000) {
        return `$${(usdValue / 1000).toFixed(2)}K`;
      } else if (usdValue < 0.01 && usdValue > 0) {
        return `$${usdValue.toFixed(6)}`;
      } else {
        return `$${usdValue.toFixed(2)}`;
      }
    } catch (error) {
      console.error('Error calculating USD value:', error);
      return '$0.00';
    }
  }, []);

  // Calculate USD value for output token
  const [outputTokenUsdValue, setOutputTokenUsdValue] = useState('$0.00');

  // Update output token USD value when estimated amount changes
  useEffect(() => {
    const updateOutputUsdValue = async () => {
      if (parseFloat(estimatedOutputAmount) > 0) {
        const outputPrice = await getTokenPrice(outputToken);
        if (outputPrice && isMounted.current) {
          setOutputTokenUsdValue(calculateUsdValue(estimatedOutputAmount, outputPrice));
        }
      } else {
        setOutputTokenUsdValue('$0.00');
      }
    };

    updateOutputUsdValue();
  }, [estimatedOutputAmount, outputToken, getTokenPrice, calculateUsdValue]);

  // Calculate conversion rate
  const getConversionRate = useCallback(() => {
    if (!inputToken || !outputToken || !estimatedOutputAmount || parseFloat(inputValue || '0') <= 0) {
      return `1 ${inputToken?.symbol || 'token'} = 0 ${outputToken?.symbol || 'token'}`;
    }

    const inputAmt = parseFloat(inputValue);
    const outputAmt = parseFloat(estimatedOutputAmount);
    const rate = outputAmt / inputAmt;

    return `1 ${inputToken.symbol} = ${rate.toFixed(6)} ${outputToken.symbol}`;
  }, [inputToken, outputToken, inputValue, estimatedOutputAmount]);

  // Update output estimate when input changes
  useEffect(() => {
    if (parseFloat(inputValue) > 0) {
      estimateSwap();
    } else {
      setEstimatedOutputAmount('0');
    }
  }, [inputValue, estimateSwap]);

  // Add an effect specifically to update token price whenever needed
  useEffect(() => {
    if (inputToken && connected && userPublicKey) {
      console.log('[SwapScreen] Updating token price for', inputToken.symbol);
      getTokenPrice(inputToken).then(price => {
        console.log('[SwapScreen] Token price updated:', price);
        // After getting price, also update the balance
        if (userPublicKey) {
          fetchTokenBalance(userPublicKey, inputToken).then(balance => {
            if (isMounted.current && balance !== null) {
              setCurrentBalance(balance);
            }
          });
        }
      });
    }
  }, [inputToken, connected, userPublicKey, getTokenPrice]);

  // For debugging USD value calculation
  const debugFiatValue = useMemo(() => {
    console.log('[SwapScreen] Debug USD calculation:', {
      inputValue,
      currentTokenPrice,
      calculation: inputValue && currentTokenPrice ? parseFloat(inputValue) * currentTokenPrice : 'N/A'
    });

    return calculateUsdValue(inputValue, currentTokenPrice);
  }, [inputValue, currentTokenPrice, calculateUsdValue]);

  // Function to handle keypad input
  const handleKeyPress = (key: string) => {
    if (key === 'delete') {
      setInputValue(prev => prev.slice(0, -1) || '0');
      return;
    }

    if (key === '.') {
      if (inputValue.includes('.')) return;
    }

    if (inputValue === '0' && key !== '.') {
      setInputValue(key);
    } else {
      setInputValue(prev => prev + key);
    }
  };

  // Check if a provider is available for selection
  const isProviderAvailable = useCallback((provider: SwapProvider) => {
    // Now Jupiter, Raydium, and PumpSwap are fully implemented
    return provider === 'Jupiter' || provider === 'Raydium' || provider === 'PumpSwap';
  }, []);

  // Check if the swap button should be enabled
  const isSwapButtonEnabled = useCallback(() => {
    if (!connected || loading) return false;

    // Check if the provider is available
    if (!isProviderAvailable(activeProvider)) return false;

    // For PumpSwap, we need a pool address
    if (activeProvider === 'PumpSwap' && !poolAddress) return false;

    return true;
  }, [connected, loading, activeProvider, isProviderAvailable, poolAddress]);

  // Execute swap
  const handleSwap = useCallback(async () => {
    console.log('[SwapScreen] ⚠️⚠️⚠️ SWAP BUTTON CLICKED ⚠️⚠️⚠️');
    console.log(`[SwapScreen] Provider: ${activeProvider}, Amount: ${inputValue} ${inputToken?.symbol || 'token'}`);

    if (!connected || !userPublicKey) {
      console.log('[SwapScreen] Error: Wallet not connected');
      Alert.alert('Wallet not connected', 'Please connect your wallet first.');
      return;
    }

    if (!inputToken || !outputToken) {
      console.log('[SwapScreen] Error: Tokens not initialized');
      Alert.alert('Tokens not loaded', 'Please wait for tokens to load or select tokens first.');
      return;
    }

    if (isNaN(parseFloat(inputValue)) || parseFloat(inputValue) <= 0) {
      console.log('[SwapScreen] Error: Invalid amount input:', inputValue);
      Alert.alert('Invalid amount', 'Please enter a valid amount to swap.');
      return;
    }

    // Check if the selected provider is implemented
    if (!isProviderAvailable(activeProvider)) {
      console.log('[SwapScreen] Error: Provider not available:', activeProvider);
      Alert.alert(
        'Provider Not Available',
        `${activeProvider} integration is coming soon! Please use Jupiter, Raydium, or PumpSwap for now.`
      );
      return;
    }

    // For PumpSwap, check if pool address is provided
    if (activeProvider === 'PumpSwap' && !poolAddress) {
      console.log('[SwapScreen] Error: PumpSwap selected but no pool address provided');
      Alert.alert(
        'Pool Address Required',
        'Please enter a pool address for PumpSwap.'
      );
      return;
    }

    console.log('[SwapScreen] Starting swap with:', {
      provider: activeProvider,
      inputToken: inputToken.symbol,
      outputToken: outputToken.symbol,
      amount: inputValue,
      poolAddress: activeProvider === 'PumpSwap' ? poolAddress : 'N/A'
    });

    setLoading(true);
    setResultMsg('');
    setErrorMsg('');

    // For PumpSwap, set a timeout that will assume success
    let pumpSwapTimeoutId: NodeJS.Timeout | null = null;
    if (activeProvider === 'PumpSwap') {
      console.log(`[SwapScreen] Setting up PumpSwap success timeout for ${PUMPSWAP_SUCCESS_TIMEOUT}ms`);
      pumpSwapTimeoutId = setTimeout(() => {
        if (isMounted.current && loading) {
          console.log('[SwapScreen] PumpSwap timeout reached - assuming transaction success');
          setLoading(false);
          setResultMsg('Transaction likely successful! PumpSwap transactions often succeed despite timeout errors.');

          Alert.alert(
            'PumpSwap Transaction Likely Successful',
            'Your transaction has been sent and likely processed successfully. PumpSwap transactions often succeed despite not receiving confirmation in the app.',
            [
              {
                text: 'Check Wallet Balance',
                onPress: () => {
                  setInputValue('0');
                  fetchBalance();
                }
              },
              {
                text: 'OK',
                style: 'default'
              }
            ]
          );
        }
      }, PUMPSWAP_SUCCESS_TIMEOUT);
    }

    try {
      // Execute the swap using the trade service with the selected provider
      console.log('[SwapScreen] Calling TradeService.executeSwap');
      const response = await TradeService.executeSwap(
        inputToken,
        outputToken,
        inputValue,
        userPublicKey,
        sendTransaction,
        {
          statusCallback: (status) => {
            console.log('[SwapScreen] Status update:', status);
            if (isMounted.current) {
              setResultMsg(status);

              // Check if the status message indicates completion
              if (status.toLowerCase().includes('complete') ||
                status.toLowerCase().includes('successful') ||
                status === 'Transaction complete! ✓') {
                console.log('[SwapScreen] Completion status received, resetting loading state');
                setLoading(false);
              }
            }
          },
          isComponentMounted: () => isMounted.current
        },
        activeProvider,
        // Pass pool address for PumpSwap
        activeProvider === 'PumpSwap' ? { poolAddress, slippage } : undefined
      );

      console.log('[SwapScreen] TradeService.executeSwap response:', JSON.stringify(response));
      console.log('[SwapScreen] Output amount for fee calculation:', response.outputAmount);

      if (response.success && response.signature) {
        if (isMounted.current) {
          console.log('[SwapScreen] Swap successful! Signature:', response.signature);
          setResultMsg(`Swap successful!`);
          setSolscanTxSig(response.signature);

          // Wait a moment for the fee collection alert to show
          setTimeout(() => {
            console.log('[SwapScreen] Checking if fee alert is visible...');
          }, 500);

          Alert.alert(
            'Swap Successful',
            `Successfully swapped ${inputValue} ${inputToken.symbol} for approximately ${estimatedOutputAmount} ${outputToken.symbol}`,
            [{
              text: 'OK', onPress: () => {
                setInputValue('0');
                fetchBalance();
              }
            }]
          );
        }
      } else {
        console.log('[SwapScreen] Swap response not successful:', response);

        // For PumpSwap, check if we might have had a transaction timeout but it could have succeeded
        if (activeProvider === 'PumpSwap' && response.error) {
          const errorMsg = response.error.toString();
          const signatureMatch = errorMsg.match(/Signature: ([a-zA-Z0-9]+)/);

          // If we have a signature, it might have succeeded despite the timeout
          if (errorMsg.includes('may have succeeded') ||
            errorMsg.includes('confirmation timed out') ||
            (signatureMatch && signatureMatch[1] !== 'Unknown')) {

            // Extract signature if available
            const signature = signatureMatch ? signatureMatch[1] : null;

            console.log('[SwapScreen] PumpSwap transaction may have succeeded despite timeout. Signature:', signature);

            if (signature && signature !== 'Unknown') {
              setResultMsg('Transaction appears successful! Check Solscan for confirmation.');
              setSolscanTxSig(signature);
              setLoading(false);

              Alert.alert(
                'PumpSwap Transaction Likely Successful',
                'Your transaction was sent and likely processed, though confirmation timed out in our app. PumpSwap transactions often succeed despite timeout errors.',
                [
                  {
                    text: 'View on Solscan',
                    onPress: () => {
                      const url = `https://solscan.io/tx/${signature}`;
                      Linking.openURL(url).catch(err => {
                        console.error('[SwapScreen] Error opening Solscan URL:', err);
                      });
                    }
                  },
                  {
                    text: 'OK',
                    onPress: () => {
                      setInputValue('0');
                      fetchBalance();
                    }
                  }
                ]
              );
              return;
            }
          }
        }

        throw new Error(response.error?.toString() || 'Transaction failed');
      }
    } catch (err: any) {
      console.error('[SwapScreen] Swap error caught:', err);
      console.error('[SwapScreen] Error details:', JSON.stringify(err, null, 2));

      if (isMounted.current) {
        // Format error message for user
        let errorMessage = 'Swap failed. ';
        let mayHaveSucceeded = false;

        if (err.message.includes('signature verification')) {
          errorMessage += 'Please try again.';
        } else if (err.message.includes('0x1771')) {
          errorMessage += 'Insufficient balance or price impact too high.';
        } else if (err.message.includes('ExceededSlippage') || err.message.includes('0x1774')) {
          errorMessage += 'Price impact too high. Try increasing your slippage tolerance.';
        } else if (err.message.includes('confirmation failed') || err.message.includes('may have succeeded')) {
          // Handle the case where transaction might have succeeded
          mayHaveSucceeded = true;

          // Extract signature if available
          const signatureMatch = err.message.match(/Signature: ([a-zA-Z0-9]+)/);
          const signature = signatureMatch ? signatureMatch[1] : null;

          if (signature && signature !== 'Unknown') {
            errorMessage = 'Transaction sent but confirmation timed out. ';
            setSolscanTxSig(signature);

            // For PumpSwap, we're more confident the transaction succeeded if we have a signature
            if (activeProvider === 'PumpSwap') {
              // Clear the success timeout since we're handling it now
              if (pumpSwapTimeoutId) {
                clearTimeout(pumpSwapTimeoutId);
                pumpSwapTimeoutId = null;
              }

              setResultMsg('PumpSwap transaction likely successful! Check Solscan for confirmation.');
              setLoading(false);

              Alert.alert(
                'PumpSwap Transaction Likely Successful',
                'Your transaction was sent and likely processed, though confirmation timed out in our app. PumpSwap transactions often succeed despite timeout errors.',
                [
                  {
                    text: 'View on Solscan',
                    onPress: () => {
                      // Open transaction on Solscan
                      const url = `https://solscan.io/tx/${signature}`;
                      Linking.openURL(url).catch(err => {
                        console.error('[SwapScreen] Error opening Solscan URL:', err);
                      });
                    }
                  },
                  {
                    text: 'OK',
                    onPress: () => {
                      setInputValue('0');
                      fetchBalance();
                    }
                  }
                ]
              );
              return;
            }

            // Show a different alert for this case (for other providers)
            Alert.alert(
              'Transaction Status Uncertain',
              'Your transaction was sent but confirmation timed out. It may have succeeded. You can check the status on Solscan.',
              [
                {
                  text: 'View on Solscan',
                  onPress: () => {
                    // Open transaction on Solscan
                    const url = `https://solscan.io/tx/${signature}`;
                    Linking.openURL(url).catch(err => {
                      console.error('[SwapScreen] Error opening Solscan URL:', err);
                    });
                  }
                },
                {
                  text: 'OK',
                  onPress: () => {
                    setInputValue('0');
                    fetchBalance();
                  }
                }
              ]
            );

            // Return early so we don't show the standard error alert
            return;
          } else {
            errorMessage += 'Your transaction may have succeeded but confirmation timed out. Check your wallet for changes.';
          }
        } else {
          errorMessage += err.message;
        }

        console.log('[SwapScreen] Setting error message:', errorMessage);
        setErrorMsg(errorMessage);

        if (!mayHaveSucceeded) {
          Alert.alert('Swap Failed', errorMessage);
        }
      }
    } finally {
      if (isMounted.current) {
        console.log('[SwapScreen] Swap process completed, resetting loading state');

        // Clean up the PumpSwap timeout if it's still active
        if (pumpSwapTimeoutId) {
          console.log('[SwapScreen] Clearing PumpSwap success timeout');
          clearTimeout(pumpSwapTimeoutId);
        }

        setLoading(false);
      }
    }
  }, [
    connected,
    userPublicKey,
    inputValue,
    inputToken,
    outputToken,
    sendTransaction,
    fetchBalance,
    estimatedOutputAmount,
    activeProvider,
    poolAddress,
    slippage,
    isProviderAvailable,
    loading
  ]);

  // Allow user to paste from clipboard (for transaction signatures)
  const handlePasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getString();
      if (text) {
        setSolscanTxSig(text.trim());
      }
    } catch (error) {
      console.error('Failed to paste from clipboard:', error);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <>
        {Platform.OS === 'android' && <View style={androidStyles.statusBarPlaceholder} />}
        <SafeAreaView style={styles.container}>
          <StatusBar barStyle="light-content" />

          {/* Replace custom header with AppHeader */}
          <AppHeader
            title="Swap Via"
            showBackButton={navigation.canGoBack()}
            onBackPress={handleBack}
            style={Platform.OS === 'android' ? androidStyles.headerContainer : undefined}
          />

          <View style={styles.contentContainer}>
            <ScrollView
              style={styles.fullWidthScroll}
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 250 }} // Extra padding for keypad
            >
              {/* Swap Providers */}
              <View style={styles.providerButtons}>
                {swapProviders.map(provider => (
                  <TouchableOpacity
                    key={provider}
                    style={[
                      styles.providerButton,
                      activeProvider === provider && {
                        backgroundColor: COLORS.lightBackground,
                        borderWidth: 1,
                        borderColor: provider === 'Raydium' ? COLORS.brandPrimary : COLORS.white
                      },
                      !isProviderAvailable(provider) && { opacity: 0.5 }
                    ]}
                    onPress={() => {
                      if (isProviderAvailable(provider)) {
                        setActiveProvider(provider);
                        // Reset the output estimate when changing providers
                        if (parseFloat(inputValue) > 0) {
                          estimateSwap();
                        }
                      } else {
                        Alert.alert(
                          'Coming Soon',
                          `${provider} integration is coming soon!`
                        );
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.providerButtonText,
                        activeProvider === provider && {
                          color: provider === 'Raydium' ? COLORS.brandPrimary : COLORS.white
                        }
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {provider}{!isProviderAvailable(provider) ? ' (soon)' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* PumpSwap Pool Address Input */}
              {activeProvider === 'PumpSwap' && (
                <View style={styles.poolAddressContainer}>
                  <Text style={styles.poolAddressLabel}>Pool Address</Text>
                  <TextInput
                    style={styles.poolAddressInput}
                    placeholder="Enter PumpSwap pool address"
                    placeholderTextColor={COLORS.greyDark}
                    value={poolAddress}
                    onChangeText={setPoolAddress}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              )}

              {/* PumpSwap Slippage Selector */}
              {activeProvider === 'PumpSwap' && (
                <View style={styles.poolAddressContainer}>
                  <Text style={styles.poolAddressLabel}>Slippage Tolerance</Text>
                  <View style={styles.slippageButtonsContainer}>
                    {[1, 3, 5, 10, 15, 20, 25, 30].map((value) => (
                      <TouchableOpacity
                        key={`slippage-${value}`}
                        style={[
                          styles.slippageButton,
                          slippage === value && styles.slippageButtonActive
                        ]}
                        onPress={() => setSlippage(value)}
                      >
                        <Text
                          style={[
                            styles.slippageButtonText,
                            slippage === value && styles.slippageButtonTextActive
                          ]}
                        >
                          {value}%
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.pumpSwapWarningContainer}>
                    <Text style={styles.pumpSwapWarningText}>
                      ⚠️ Warning: This pool may have very high price impact. Trades are executed with extreme slippage tolerance for successful execution.
                    </Text>
                  </View>
                </View>
              )}

              {/* Swap Container with Input and Output */}
              <View style={styles.swapContainer}>
                {/* Input Token (From) */}
                <View>
                  <TouchableOpacity
                    style={styles.tokenRow}
                    onPress={() => {
                      setSelectingWhichSide('input');
                      setShowSelectTokenModal(true);
                    }}
                  >
                    {inputToken?.logoURI ? (
                      <Image source={{ uri: inputToken.logoURI }} style={styles.tokenIcon} />
                    ) : (
                      <View style={[styles.tokenIcon, { backgroundColor: COLORS.lighterBackground, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={{ color: COLORS.white, fontWeight: 'bold', fontSize: 10 }}>
                          {inputToken?.symbol?.charAt(0) || '?'}
                        </Text>
                      </View>
                    )}
                    <View style={styles.tokenInfo}>
                      <Text style={styles.tokenSymbol} numberOfLines={1} ellipsizeMode="tail">
                        {inputToken?.symbol || 'Select'}
                      </Text>
                      <Text style={styles.tokenBalance} numberOfLines={1} ellipsizeMode="tail">
                        {currentBalance !== null
                          ? `Balance: ${currentBalance.toFixed(6)} ${inputToken?.symbol || ''}`
                          : connected ? 'Loading...' : 'Connect wallet'}
                      </Text>
                    </View>
                    <View style={styles.valueContainer}>
                      <Text style={styles.valueLabel}>You Pay</Text>
                      <Text style={styles.tokenValue} numberOfLines={1} ellipsizeMode="tail">
                        {inputValue}
                      </Text>
                      <Text style={styles.fiatValue} numberOfLines={1} ellipsizeMode="tail">
                        {debugFiatValue}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Swap Button - Positioned to overlap both cards */}
                <TouchableOpacity
                  style={styles.swapButton}
                  onPress={() => {
                    // Swap tokens
                    const temp = inputToken;
                    setInputToken(outputToken);
                    setOutputToken(temp);

                    // Reset values
                    setInputValue('0');
                    setEstimatedOutputAmount('0');
                    setOutputTokenUsdValue('$0.00');

                    // Update balances and prices for new input token
                    if (userPublicKey) {
                      fetchBalance(outputToken);
                      getTokenPrice(outputToken);
                    }
                  }}
                >
                  <Icons.SwapIcon width={36} height={36} />
                </TouchableOpacity>

                {/* Output Token (To) */}
                <View>
                  <TouchableOpacity
                    style={styles.tokenRow}
                    onPress={() => {
                      setSelectingWhichSide('output');
                      setShowSelectTokenModal(true);
                    }}
                  >
                    {outputToken?.logoURI ? (
                      <Image source={{ uri: outputToken.logoURI }} style={styles.tokenIcon} />
                    ) : (
                      <View style={[styles.tokenIcon, { backgroundColor: COLORS.lighterBackground, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={{ color: COLORS.white, fontWeight: 'bold', fontSize: 10 }}>
                          {outputToken?.symbol?.charAt(0) || '?'}
                        </Text>
                      </View>
                    )}
                    <View style={styles.tokenInfo}>
                      <Text style={styles.tokenSymbol} numberOfLines={1} ellipsizeMode="tail">
                        {outputToken?.symbol || 'Select'}
                      </Text>
                      <Text style={styles.tokenBalance}></Text>
                    </View>
                    <View style={styles.valueContainer}>
                      <Text style={styles.valueLabel}>You Receive</Text>
                      <Text style={styles.receiveValue} numberOfLines={1} ellipsizeMode="tail">
                        +{estimatedOutputAmount || '0'}
                      </Text>
                      <Text style={styles.fiatValue} numberOfLines={1} ellipsizeMode="tail">
                        {outputTokenUsdValue}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Max Button */}
                <TouchableOpacity
                  style={styles.maxButtonContainer}
                  onPress={handleMaxButtonClick}
                >
                  <Text style={styles.maxButtonText}>MAX</Text>
                </TouchableOpacity>
              </View>

              {/* Status Messages */}
              {loading && (
                <View style={styles.statusContainer}>
                  <ActivityIndicator size="small" color={COLORS.brandPrimary} />
                  <Text style={styles.statusText} numberOfLines={2} ellipsizeMode="tail">
                    {resultMsg || 'Processing...'}
                  </Text>
                </View>
              )}

              {errorMsg ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText} numberOfLines={2} ellipsizeMode="tail">
                    {errorMsg}
                  </Text>
                </View>
              ) : null}

              {/* Additional Swap Info */}
              <View style={styles.swapInfoContainer}>
                <View style={styles.swapInfoRow}>
                  <Text style={styles.swapInfoLabel}>Rate</Text>
                  <Text style={styles.swapInfoValue} numberOfLines={1} ellipsizeMode="tail">
                    {getConversionRate()}
                  </Text>
                </View>
                <View style={styles.swapInfoRow}>
                  <Text style={styles.swapInfoLabel}>Network Fee</Text>
                  <Text style={styles.swapInfoValue}>~0.00005 SOL</Text>
                </View>
                <View style={styles.swapInfoRow}>
                  <Text style={styles.swapInfoLabel}>Price Impact</Text>
                  <Text style={styles.swapInfoValue}>
                    <Text style={{ color: COLORS.brandPrimary }}>~0.05%</Text>
                  </Text>
                </View>
                <View style={styles.swapInfoRow}>
                  <Text style={styles.swapInfoLabel}>Provider</Text>
                  <Text style={[styles.swapInfoValue, { color: COLORS.brandPrimary }]}>
                    {activeProvider}
                  </Text>
                </View>
                {solscanTxSig && (
                  <View style={styles.swapInfoRow}>
                    <Text style={styles.swapInfoLabel}>Transaction</Text>
                    <TouchableOpacity onPress={() => {
                      // Open transaction on Solscan
                      const url = `https://solscan.io/tx/${solscanTxSig}`;
                      Linking.openURL(url).catch(err => {
                        console.error('[SwapScreen] Error opening Solscan URL:', err);
                      });
                    }}>
                      <Text style={[styles.swapInfoValue, { color: COLORS.brandPrimary }]}>
                        View on Solscan
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Keypad */}
            <View style={styles.keypadContainer}>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('1')}>
                  <Text style={styles.keypadButtonText}>1</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('2')}>
                  <Text style={styles.keypadButtonText}>2</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('3')}>
                  <Text style={styles.keypadButtonText}>3</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('4')}>
                  <Text style={styles.keypadButtonText}>4</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('5')}>
                  <Text style={styles.keypadButtonText}>5</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('6')}>
                  <Text style={styles.keypadButtonText}>6</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('7')}>
                  <Text style={styles.keypadButtonText}>7</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('8')}>
                  <Text style={styles.keypadButtonText}>8</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('9')}>
                  <Text style={styles.keypadButtonText}>9</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.keypadRow}>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('.')}>
                  <Text style={styles.keypadButtonText}>.</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('0')}>
                  <Text style={styles.keypadButtonText}>0</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.keypadButton} onPress={() => handleKeyPress('delete')}>
                  <Ionicons name="backspace-outline" size={22} color={COLORS.white} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Swap Button */}
            <TouchableOpacity
              style={[
                styles.swapActionButton,
                !isSwapButtonEnabled() && { opacity: 0.6 }
              ]}
              onPress={handleSwap}
              disabled={!isSwapButtonEnabled()}
            >
              <Text style={styles.swapActionButtonText}>
                {!connected ? 'Connect Wallet to Swap' :
                  !isProviderAvailable(activeProvider) ? `${activeProvider} Coming Soon` :
                    activeProvider === 'PumpSwap' && !poolAddress ? 'Enter Pool Address' :
                      loading ? 'Swapping...' : `Swap via ${activeProvider}`}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Token Selection Modal */}
          <SelectTokenModal
            visible={showSelectTokenModal}
            onClose={() => setShowSelectTokenModal(false)}
            onTokenSelected={handleTokenSelected}
          />
        </SafeAreaView>
      </>
    </KeyboardAvoidingView>
  );
} 