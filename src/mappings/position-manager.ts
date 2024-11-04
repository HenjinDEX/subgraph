/* eslint-disable prefer-const */
import {
  Collect,
  IncreaseLiquidity,
  DecreaseLiquidity,
  NonfungiblePositionManager,
  Transfer
} from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Bundle, Position, PositionSnapshot, Token} from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ZERO_BD, ZERO_BI, pools_list, ONE_BI} from '../utils/constants'
import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'
import { convertTokenToDecimal, loadTransaction } from '../utils'
import { getOrCreateUser } from './core'



function getPosition(event: ethereum.Event, tokenId: BigInt): Position | null {


  let position = Position.load(tokenId.toString())
  if (position === null) {
    let contract = NonfungiblePositionManager.bind(event.address)
    let positionCall = contract.try_positions(tokenId)

    // the following call reverts in situations where the position is minted
    // and deleted in the same block 
    const stringBoolean = `${positionCall.reverted}`;
    if (!positionCall.reverted) {
      let positionResult = positionCall.value
      let poolAddress = factoryContract.poolByPair(positionResult.value2, positionResult.value3)

      position = new Position(tokenId.toString())
      // The owner gets correctly updated in the Transfer handler
      position.owner = Address.fromString(ADDRESS_ZERO)
      position.pool = poolAddress.toHexString()
      if(pools_list.includes(position.pool)){
        position.token0 = positionResult.value3.toHexString()
        position.token1 = positionResult.value2.toHexString()
      }
      else{
        position.token0 = positionResult.value2.toHexString()
        position.token1 = positionResult.value3.toHexString()
      } 
      position.tickLower = position.pool.concat('#').concat(positionResult.value4.toString())
      position.tickUpper = position.pool.concat('#').concat(positionResult.value5.toString())
      position.liquidity = ZERO_BI
      position.depositedToken0 = ZERO_BD
      position.depositedToken1 = ZERO_BD
      position.withdrawnToken0 = ZERO_BD
      position.withdrawnToken1 = ZERO_BD
      position.collectedToken0 = ZERO_BD
      position.collectedToken1 = ZERO_BD
      position.collectedFeesToken0 = ZERO_BD
      position.collectedFeesToken1 = ZERO_BD
      position.transaction = loadTransaction(event).id
      position.feeGrowthInside0LastX128 = positionResult.value7
      position.feeGrowthInside1LastX128 = positionResult.value8
    }
  }

  return position
  
  return null 
}


function updateFeeVars(position: Position, event: ethereum.Event, tokenId: BigInt): Position {

  let positionManagerContract = NonfungiblePositionManager.bind(event.address)
  let positionResult = positionManagerContract.try_positions(tokenId)
  if (!positionResult.reverted) {
    position.feeGrowthInside0LastX128 = positionResult.value.value7
    position.feeGrowthInside1LastX128 = positionResult.value.value8
  }
  return position
}

function savePositionSnapshot(position: Position, event: ethereum.Event): void {
  
  let positionSnapshot = new PositionSnapshot(position.id.concat('#').concat(event.block.number.toString()))
  positionSnapshot.owner = position.owner
  positionSnapshot.pool = position.pool
  positionSnapshot.position = position.id
  positionSnapshot.blockNumber = event.block.number
  positionSnapshot.timestamp = event.block.timestamp
  positionSnapshot.liquidity = position.liquidity

  if(pools_list.includes(position.pool)){
    positionSnapshot.depositedToken0 = position.depositedToken1
    positionSnapshot.depositedToken1 = position.depositedToken0
    positionSnapshot.withdrawnToken0 = position.withdrawnToken1
    positionSnapshot.withdrawnToken1 = position.withdrawnToken0
    positionSnapshot.collectedFeesToken0 = position.collectedFeesToken1
    positionSnapshot.collectedFeesToken1 = position.collectedFeesToken0
    positionSnapshot.transaction = loadTransaction(event).id
    positionSnapshot.feeGrowthInside0LastX128 = position.feeGrowthInside1LastX128
    positionSnapshot.feeGrowthInside1LastX128 = position.feeGrowthInside0LastX128
  }
  else{
    positionSnapshot.depositedToken0 = position.depositedToken0
    positionSnapshot.depositedToken1 = position.depositedToken1
    positionSnapshot.withdrawnToken0 = position.withdrawnToken0
    positionSnapshot.withdrawnToken1 = position.withdrawnToken1
    positionSnapshot.collectedFeesToken0 = position.collectedFeesToken0
    positionSnapshot.collectedFeesToken1 = position.collectedFeesToken1
    positionSnapshot.transaction = loadTransaction(event).id
    positionSnapshot.feeGrowthInside0LastX128 = position.feeGrowthInside0LastX128
    positionSnapshot.feeGrowthInside1LastX128 = position.feeGrowthInside1LastX128
  }

  positionSnapshot.save()
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  let bundle = Bundle.load('1')!
  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  let token0 = Token.load(position.token0)!
  let token1 = Token.load(position.token1)!

  let amount1 = ZERO_BD
  let amount0 = ZERO_BD

  if (pools_list.includes(position.pool)) {
    amount0 = convertTokenToDecimal(event.params.amount1, token0!.decimals)
    amount1 = convertTokenToDecimal(event.params.amount0, token1!.decimals)
  } else {
    amount0 = convertTokenToDecimal(event.params.amount0, token0!.decimals)
    amount1 = convertTokenToDecimal(event.params.amount1, token1!.decimals)
  }

  position.liquidity = position.liquidity.plus(event.params.liquidity)
  position.depositedToken0 = position.depositedToken0.plus(amount0)
  position.depositedToken1 = position.depositedToken1.plus(amount1)
  // recalculatePosition(position)
  position.save()
  savePositionSnapshot(position, event)

  const user = getOrCreateUser(position.owner.toHexString(), event.block.timestamp)
  if (position.depositedToken0.equals(amount0) && position.depositedToken1.equals(amount1)) {
    user.positionsCount = user.positionsCount.plus(ONE_BI)
    user.activePools.push(position.pool)
  }

  let amountUSD = amount0
    .times(token0.derivedMatic.times(bundle.maticPriceUSD))
    .plus(amount1.times(token1.derivedMatic.times(bundle.maticPriceUSD)))

  user.totalValueLockedUSD = user.totalValueLockedUSD.plus(amountUSD)
  user.save()
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  let bundle = Bundle.load('1')!
  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  let token0 = Token.load(position.token0)!
  let token1 = Token.load(position.token1)!

  let amount1 = ZERO_BD
  let amount0 = ZERO_BD

  if (pools_list.includes(position.pool)) {
    amount0 = convertTokenToDecimal(event.params.amount1, token0!.decimals)
    amount1 = convertTokenToDecimal(event.params.amount0, token1!.decimals)
  } else {
    amount0 = convertTokenToDecimal(event.params.amount0, token0!.decimals)
    amount1 = convertTokenToDecimal(event.params.amount1, token1!.decimals)
  }
  
  position.liquidity = position.liquidity.minus(event.params.liquidity)
  position.withdrawnToken0 = position.withdrawnToken0.plus(amount0)
  position.withdrawnToken1 = position.withdrawnToken1.plus(amount1)

  position = updateFeeVars(position, event, event.params.tokenId)
  // recalculatePosition(position)
  position.save()
  savePositionSnapshot(position, event)

  const user = getOrCreateUser(position.owner.toHexString(), event.block.timestamp)
  if (position.depositedToken0.equals(position.withdrawnToken0) && position.depositedToken1.equals(position.withdrawnToken1)) {
    user.positionsCount = user.positionsCount.minus(ONE_BI)
    let index = user.activePools.indexOf(position.pool)
    if (index > -1) {
      user.activePools.splice(index, 1)
    }
  }

  let amountUSD = amount0
    .times(token0.derivedMatic.times(bundle.maticPriceUSD))
    .plus(amount1.times(token1.derivedMatic.times(bundle.maticPriceUSD)))

  if (user.totalValueLockedUSD.gt(amountUSD)) {
    user.totalValueLockedUSD = user.totalValueLockedUSD.minus(amountUSD)
  } else {
    user.totalValueLockedUSD = ZERO_BD
  }

  user.save()
}


export function handleCollect(event: Collect): void {
  let bundle = Bundle.load('1')!
  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  let token0 = Token.load(position.token0)!
  let token1 = Token.load(position.token1)!

  let amount1 = ZERO_BD
  let amount0 = ZERO_BD

  if (pools_list.includes(position.pool)) {
    amount0 = convertTokenToDecimal(event.params.amount1, token0!.decimals)
    amount1 = convertTokenToDecimal(event.params.amount0, token1!.decimals)
  } else {
    amount0 = convertTokenToDecimal(event.params.amount0, token0!.decimals)
    amount1 = convertTokenToDecimal(event.params.amount1, token1!.decimals)
  
  }

  position.collectedToken0 = position.collectedToken0.plus(amount0)
  position.collectedToken1 = position.collectedToken1.plus(amount1)

  position.collectedFeesToken0 = position.collectedToken0.minus(position.withdrawnToken0)
  position.collectedFeesToken1 = position.collectedToken1.minus(position.withdrawnToken1)

  position = updateFeeVars(position, event, event.params.tokenId)
  // recalculatePosition(position)
  position.save()
  savePositionSnapshot(position, event)

  const user = getOrCreateUser(position.owner.toHexString(), event.block.timestamp)
  let amountUSD = amount0
    .times(token0.derivedMatic.times(bundle.maticPriceUSD))
    .plus(amount1.times(token1.derivedMatic.times(bundle.maticPriceUSD)))

  user.feesEarned = user.feesEarned.plus(amountUSD)
  if (user.totalValueLockedUSD.gt(amountUSD)) {
    user.totalValueLockedUSD = user.totalValueLockedUSD.minus(amountUSD)
  } else {
    user.totalValueLockedUSD = ZERO_BD
  }

  user.save()
}

export function handleTransfer(event: Transfer): void {
  const bundle = Bundle.load('1')!
  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  const token0 = Token.load(position.token0)!
  const token1 = Token.load(position.token1)!

  position.owner = event.params.to
  position.save()

  savePositionSnapshot(position, event)

  let amount0 = position.depositedToken0.minus(position.withdrawnToken0).minus(position.collectedFeesToken0)
  let amount1 = position.depositedToken1.minus(position.withdrawnToken1).minus(position.collectedFeesToken1)

  let amountUSD = amount0
    .times(token0.derivedMatic.times(bundle.maticPriceUSD))
    .plus(amount1.times(token1.derivedMatic.times(bundle.maticPriceUSD)))
  
  const user = getOrCreateUser(event.params.from.toHexString(), event.block.timestamp)
  user.positionsCount = user.positionsCount.minus(ONE_BI)
  let index = user.activePools.indexOf(position.pool)
  if (index > -1) {
    user.activePools.splice(index, 1)
  }

  if (user.totalValueLockedUSD.gt(amountUSD)) {
    user.totalValueLockedUSD = user.totalValueLockedUSD.minus(amountUSD)
  } else {
    user.totalValueLockedUSD = ZERO_BD
  }

  user.save()

  const newUser = getOrCreateUser(event.params.to.toHexString(), event.block.timestamp)
  newUser.positionsCount = newUser.positionsCount.plus(ONE_BI)
  newUser.activePools.push(position.pool)
  newUser.totalValueLockedUSD = newUser.totalValueLockedUSD.plus(amountUSD)
  newUser.save()
}

