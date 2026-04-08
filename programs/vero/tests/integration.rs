use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData};
use anchor_spl::token::spl_token;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use vero::state::{BorrowPosition, LendingPool, ProbabilityOracle};

use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

const USDC_DECIMALS: u8 = 6;

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(vero::ID, "../../target/deploy/vero.so");
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    (svm, admin)
}

fn create_mint(svm: &mut LiteSVM, authority: &Keypair, decimals: u8) -> Pubkey {
    let mint = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(82);
    let create_ix = anchor_lang::solana_program::system_instruction::create_account(
        &authority.pubkey(),
        &mint.pubkey(),
        rent,
        82,
        &spl_token::ID,
    );
    let init_mint_ix = spl_token::instruction::initialize_mint2(
        &spl_token::ID,
        &mint.pubkey(),
        &authority.pubkey(),
        None,
        decimals,
    )
    .unwrap();

    let msg = Message::new(&[create_ix, init_mint_ix], Some(&authority.pubkey()));
    let tx = Transaction::new(&[authority, &mint], msg, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();
    mint.pubkey()
}

fn create_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Pubkey {
    let account = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(165);
    let create_ix = anchor_lang::solana_program::system_instruction::create_account(
        &payer.pubkey(),
        &account.pubkey(),
        rent,
        165,
        &spl_token::ID,
    );
    let init_ix = spl_token::instruction::initialize_account(
        &spl_token::ID,
        &account.pubkey(),
        mint,
        owner,
    )
    .unwrap();

    let msg = Message::new(&[create_ix, init_ix], Some(&payer.pubkey()));
    let tx = Transaction::new(&[payer, &account], msg, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();
    account.pubkey()
}

fn mint_to(svm: &mut LiteSVM, authority: &Keypair, mint: &Pubkey, dest: &Pubkey, amount: u64) {
    let ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        mint,
        dest,
        &authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();
    let msg = Message::new(&[ix], Some(&authority.pubkey()));
    let tx = Transaction::new(&[authority], msg, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();
}

fn find_pool_pda(usdc_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"pool", usdc_mint.as_ref()], &vero::ID)
}

fn find_vault_pda(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"vault", pool.as_ref()], &vero::ID)
}

fn find_lender_pda(pool: &Pubkey, lender: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"lender", pool.as_ref(), lender.as_ref()], &vero::ID)
}

fn find_oracle_pda(market_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"oracle", market_mint.as_ref()], &vero::ID)
}

fn find_borrow_pda(pool: &Pubkey, borrower: &Pubkey, collateral_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"borrow", pool.as_ref(), borrower.as_ref(), collateral_mint.as_ref()],
        &vero::ID,
    )
}

fn find_collateral_vault_pda(borrow_position: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"collateral_vault", borrow_position.as_ref()], &vero::ID)
}

fn init_pool_ix(admin: &Pubkey, usdc_mint: &Pubkey, pool: &Pubkey, vault: &Pubkey) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*admin, true),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data: vero::instruction::InitializePool {
            interest_rate_bps: 500,
            liquidation_bonus_bps: 500,
            max_ltv_bps: 5000,
            liquidation_threshold_bps: 6500,
        }
        .data(),
    }
}

fn deposit_ix(
    lender: &Pubkey,
    pool: &Pubkey,
    lender_position: &Pubkey,
    usdc_mint: &Pubkey,
    lender_usdc: &Pubkey,
    vault: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*lender, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*lender_position, false),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new(*lender_usdc, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data: vero::instruction::Deposit { amount }.data(),
    }
}

fn withdraw_ix(
    lender: &Pubkey,
    pool: &Pubkey,
    lender_position: &Pubkey,
    usdc_mint: &Pubkey,
    lender_usdc: &Pubkey,
    vault: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*lender, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new(*lender_position, false),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new(*lender_usdc, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data: vero::instruction::Withdraw { amount }.data(),
    }
}

fn init_oracle_ix(
    authority: &Pubkey,
    market_mint: &Pubkey,
    oracle: &Pubkey,
    probability_bps: u16,
) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(*market_mint, false),
            AccountMeta::new(*oracle, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data: vero::instruction::InitializeOracle {
            initial_probability_bps: probability_bps,
            resolution_ts: 0,
        }
        .data(),
    }
}

fn borrow_ix(
    borrower: &Pubkey,
    pool: &Pubkey,
    collateral_mint: &Pubkey,
    oracle: &Pubkey,
    borrow_position: &Pubkey,
    collateral_vault: &Pubkey,
    borrower_collateral: &Pubkey,
    usdc_mint: &Pubkey,
    borrower_usdc: &Pubkey,
    vault: &Pubkey,
    collateral_amount: u64,
    borrow_amount: u64,
) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*borrower, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new_readonly(*collateral_mint, false),
            AccountMeta::new_readonly(*oracle, false),
            AccountMeta::new(*borrow_position, false),
            AccountMeta::new(*collateral_vault, false),
            AccountMeta::new(*borrower_collateral, false),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new(*borrower_usdc, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(anchor_lang::solana_program::system_program::ID, false),
        ],
        data: vero::instruction::Borrow {
            collateral_amount,
            borrow_amount,
            resolution_ts: 0,
        }
        .data(),
    }
}

fn repay_ix(
    borrower: &Pubkey,
    pool: &Pubkey,
    collateral_mint: &Pubkey,
    usdc_mint: &Pubkey,
    borrow_position: &Pubkey,
    collateral_vault: &Pubkey,
    borrower_collateral: &Pubkey,
    borrower_usdc: &Pubkey,
    vault: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*borrower, true),
            AccountMeta::new(*pool, false),
            AccountMeta::new_readonly(*collateral_mint, false),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new(*borrow_position, false),
            AccountMeta::new(*collateral_vault, false),
            AccountMeta::new(*borrower_collateral, false),
            AccountMeta::new(*borrower_usdc, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data: vero::instruction::Repay { amount }.data(),
    }
}

// === TESTS ===

#[test]
fn test_initialize_pool() {
    let (mut svm, admin) = setup();
    let usdc_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let (pool_pda, _) = find_pool_pda(&usdc_mint);
    let (vault_pda, _) = find_vault_pda(&pool_pda);

    let ix = init_pool_ix(&admin.pubkey(), &usdc_mint, &pool_pda, &vault_pda);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    let tx = Transaction::new(&[&admin], msg, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let pool_account = svm.get_account(&pool_pda).unwrap();
    let pool = LendingPool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.authority, admin.pubkey());
    assert_eq!(pool.usdc_mint, usdc_mint);
    assert_eq!(pool.interest_rate_bps, 500);
    assert_eq!(pool.max_ltv_bps, 5000);
    assert_eq!(pool.total_deposits, 0);
    assert_eq!(pool.total_borrowed, 0);
}

#[test]
fn test_deposit_and_withdraw() {
    let (mut svm, admin) = setup();
    let usdc_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let (pool_pda, _) = find_pool_pda(&usdc_mint);
    let (vault_pda, _) = find_vault_pda(&pool_pda);

    // Init pool
    let ix = init_pool_ix(&admin.pubkey(), &usdc_mint, &pool_pda, &vault_pda);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash()))
        .unwrap();

    // Setup lender
    let lender = Keypair::new();
    svm.airdrop(&lender.pubkey(), 10_000_000_000).unwrap();
    let lender_usdc = create_token_account(&mut svm, &lender, &usdc_mint, &lender.pubkey());
    mint_to(&mut svm, &admin, &usdc_mint, &lender_usdc, 1_000_000_000);
    let (lender_pos, _) = find_lender_pda(&pool_pda, &lender.pubkey());

    // Deposit 500 USDC
    let ix = deposit_ix(
        &lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda,
        500_000_000,
    );
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash()))
        .unwrap();

    let pool_account = svm.get_account(&pool_pda).unwrap();
    let pool = LendingPool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.total_deposits, 500_000_000);

    // Withdraw 200 USDC
    let ix = withdraw_ix(
        &lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda,
        200_000_000,
    );
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash()))
        .unwrap();

    let pool_account = svm.get_account(&pool_pda).unwrap();
    let pool = LendingPool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.total_deposits, 300_000_000);
}

#[test]
fn test_borrow_and_repay() {
    let (mut svm, admin) = setup();
    let usdc_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let prediction_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let (pool_pda, _) = find_pool_pda(&usdc_mint);
    let (vault_pda, _) = find_vault_pda(&pool_pda);

    // Init pool
    let ix = init_pool_ix(&admin.pubkey(), &usdc_mint, &pool_pda, &vault_pda);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash()))
        .unwrap();

    // Seed liquidity
    let lender = Keypair::new();
    svm.airdrop(&lender.pubkey(), 10_000_000_000).unwrap();
    let lender_usdc = create_token_account(&mut svm, &lender, &usdc_mint, &lender.pubkey());
    mint_to(&mut svm, &admin, &usdc_mint, &lender_usdc, 10_000_000_000);
    let (lender_pos, _) = find_lender_pda(&pool_pda, &lender.pubkey());
    let ix = deposit_ix(
        &lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda,
        10_000_000_000,
    );
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash()))
        .unwrap();

    // Init oracle at 75%
    let (oracle_pda, _) = find_oracle_pda(&prediction_mint);
    let ix = init_oracle_ix(&admin.pubkey(), &prediction_mint, &oracle_pda, 7500);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash()))
        .unwrap();

    // Setup borrower
    let borrower = Keypair::new();
    svm.airdrop(&borrower.pubkey(), 10_000_000_000).unwrap();
    let borrower_collateral = create_token_account(&mut svm, &borrower, &prediction_mint, &borrower.pubkey());
    let borrower_usdc = create_token_account(&mut svm, &borrower, &usdc_mint, &borrower.pubkey());
    mint_to(&mut svm, &admin, &prediction_mint, &borrower_collateral, 1_000_000_000);

    let (borrow_pos, _) = find_borrow_pda(&pool_pda, &borrower.pubkey(), &prediction_mint);
    let (collateral_vault, _) = find_collateral_vault_pda(&borrow_pos);

    // Borrow 300 USDC (max = 1000 * 0.75 * 0.50 = 375)
    let ix = borrow_ix(
        &borrower.pubkey(), &pool_pda, &prediction_mint, &oracle_pda,
        &borrow_pos, &collateral_vault, &borrower_collateral,
        &usdc_mint, &borrower_usdc, &vault_pda,
        1_000_000_000, 300_000_000,
    );
    let msg = Message::new(&[ix], Some(&borrower.pubkey()));
    svm.send_transaction(Transaction::new(&[&borrower], msg, svm.latest_blockhash()))
        .unwrap();

    // Verify borrow
    let pos_account = svm.get_account(&borrow_pos).unwrap();
    let pos = BorrowPosition::try_deserialize(&mut pos_account.data.as_slice()).unwrap();
    assert_eq!(pos.collateral_amount, 1_000_000_000);
    assert_eq!(pos.borrowed_amount, 300_000_000);
    assert_eq!(pos.entry_probability_bps, 7500);

    // Repay full
    mint_to(&mut svm, &admin, &usdc_mint, &borrower_usdc, 300_000_000);
    let ix = repay_ix(
        &borrower.pubkey(), &pool_pda, &prediction_mint, &usdc_mint,
        &borrow_pos, &collateral_vault, &borrower_collateral,
        &borrower_usdc, &vault_pda,
        300_000_000,
    );
    let msg = Message::new(&[ix], Some(&borrower.pubkey()));
    svm.send_transaction(Transaction::new(&[&borrower], msg, svm.latest_blockhash()))
        .unwrap();

    let pool_account = svm.get_account(&pool_pda).unwrap();
    let pool = LendingPool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.total_borrowed, 0);
}

#[test]
fn test_borrow_exceeds_ltv_fails() {
    let (mut svm, admin) = setup();
    let usdc_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let prediction_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let (pool_pda, _) = find_pool_pda(&usdc_mint);
    let (vault_pda, _) = find_vault_pda(&pool_pda);

    // Init pool
    let ix = init_pool_ix(&admin.pubkey(), &usdc_mint, &pool_pda, &vault_pda);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    // Seed liquidity
    let lender = Keypair::new();
    svm.airdrop(&lender.pubkey(), 10_000_000_000).unwrap();
    let lender_usdc = create_token_account(&mut svm, &lender, &usdc_mint, &lender.pubkey());
    mint_to(&mut svm, &admin, &usdc_mint, &lender_usdc, 10_000_000_000);
    let (lender_pos, _) = find_lender_pda(&pool_pda, &lender.pubkey());
    let ix = deposit_ix(
        &lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda,
        10_000_000_000,
    );
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash())).unwrap();

    // Oracle at 75%
    let (oracle_pda, _) = find_oracle_pda(&prediction_mint);
    let ix = init_oracle_ix(&admin.pubkey(), &prediction_mint, &oracle_pda, 7500);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    // Borrower tries 400 USDC (max = 375)
    let borrower = Keypair::new();
    svm.airdrop(&borrower.pubkey(), 10_000_000_000).unwrap();
    let borrower_collateral = create_token_account(&mut svm, &borrower, &prediction_mint, &borrower.pubkey());
    let borrower_usdc = create_token_account(&mut svm, &borrower, &usdc_mint, &borrower.pubkey());
    mint_to(&mut svm, &admin, &prediction_mint, &borrower_collateral, 1_000_000_000);

    let (borrow_pos, _) = find_borrow_pda(&pool_pda, &borrower.pubkey(), &prediction_mint);
    let (collateral_vault, _) = find_collateral_vault_pda(&borrow_pos);

    let ix = borrow_ix(
        &borrower.pubkey(), &pool_pda, &prediction_mint, &oracle_pda,
        &borrow_pos, &collateral_vault, &borrower_collateral,
        &usdc_mint, &borrower_usdc, &vault_pda,
        1_000_000_000, 400_000_000, // exceeds LTV
    );
    let msg = Message::new(&[ix], Some(&borrower.pubkey()));
    let tx = Transaction::new(&[&borrower], msg, svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "Borrow exceeding LTV should fail");
}

// === Additional helpers ===

fn update_oracle_ix(authority: &Pubkey, oracle: &Pubkey, probability_bps: u16) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*oracle, false),
        ],
        data: vero::instruction::UpdateOracle { probability_bps }.data(),
    }
}

fn resolve_oracle_ix(authority: &Pubkey, oracle: &Pubkey, outcome: bool) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new(*oracle, false),
        ],
        data: vero::instruction::ResolveOracle { outcome }.data(),
    }
}

fn liquidate_ix(
    liquidator: &Pubkey,
    borrower: &Pubkey,
    pool: &Pubkey,
    collateral_mint: &Pubkey,
    oracle: &Pubkey,
    usdc_mint: &Pubkey,
    borrow_position: &Pubkey,
    collateral_vault: &Pubkey,
    liquidator_usdc: &Pubkey,
    liquidator_collateral: &Pubkey,
    vault: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: vero::ID,
        accounts: vec![
            AccountMeta::new(*liquidator, true),
            AccountMeta::new_readonly(*borrower, false),
            AccountMeta::new(*pool, false),
            AccountMeta::new_readonly(*collateral_mint, false),
            AccountMeta::new_readonly(*oracle, false),
            AccountMeta::new_readonly(*usdc_mint, false),
            AccountMeta::new(*borrow_position, false),
            AccountMeta::new(*collateral_vault, false),
            AccountMeta::new(*liquidator_usdc, false),
            AccountMeta::new(*liquidator_collateral, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data: vero::instruction::Liquidate {}.data(),
    }
}

/// Sets up a pool with liquidity, oracle, and a borrower with an open position.
/// Returns (pool, vault, oracle, borrower, borrower_usdc, borrower_collateral, borrow_pos, collateral_vault)
fn setup_borrow_scenario(
    svm: &mut LiteSVM,
    admin: &Keypair,
    probability_bps: u16,
) -> (Pubkey, Pubkey, Pubkey, Keypair, Pubkey, Pubkey, Pubkey, Pubkey, Pubkey, Pubkey) {
    let usdc_mint = create_mint(svm, admin, USDC_DECIMALS);
    let prediction_mint = create_mint(svm, admin, USDC_DECIMALS);
    let (pool_pda, _) = find_pool_pda(&usdc_mint);
    let (vault_pda, _) = find_vault_pda(&pool_pda);

    // Init pool
    let ix = init_pool_ix(&admin.pubkey(), &usdc_mint, &pool_pda, &vault_pda);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[admin], msg, svm.latest_blockhash())).unwrap();

    // Seed liquidity
    let lender = Keypair::new();
    svm.airdrop(&lender.pubkey(), 10_000_000_000).unwrap();
    let lender_usdc = create_token_account(svm, &lender, &usdc_mint, &lender.pubkey());
    mint_to(svm, admin, &usdc_mint, &lender_usdc, 10_000_000_000);
    let (lender_pos, _) = find_lender_pda(&pool_pda, &lender.pubkey());
    let ix = deposit_ix(&lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda, 10_000_000_000);
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash())).unwrap();

    // Init oracle
    let (oracle_pda, _) = find_oracle_pda(&prediction_mint);
    let ix = init_oracle_ix(&admin.pubkey(), &prediction_mint, &oracle_pda, probability_bps);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[admin], msg, svm.latest_blockhash())).unwrap();

    // Setup borrower and borrow
    let borrower = Keypair::new();
    svm.airdrop(&borrower.pubkey(), 10_000_000_000).unwrap();
    let borrower_collateral = create_token_account(svm, &borrower, &prediction_mint, &borrower.pubkey());
    let borrower_usdc = create_token_account(svm, &borrower, &usdc_mint, &borrower.pubkey());
    mint_to(svm, admin, &prediction_mint, &borrower_collateral, 1_000_000_000);

    let (borrow_pos, _) = find_borrow_pda(&pool_pda, &borrower.pubkey(), &prediction_mint);
    let (collateral_vault, _) = find_collateral_vault_pda(&borrow_pos);

    // Borrow 300 USDC against 1000 tokens at given probability
    let ix = borrow_ix(
        &borrower.pubkey(), &pool_pda, &prediction_mint, &oracle_pda,
        &borrow_pos, &collateral_vault, &borrower_collateral,
        &usdc_mint, &borrower_usdc, &vault_pda,
        1_000_000_000, 300_000_000,
    );
    let msg = Message::new(&[ix], Some(&borrower.pubkey()));
    svm.send_transaction(Transaction::new(&[&borrower], msg, svm.latest_blockhash())).unwrap();

    (pool_pda, vault_pda, oracle_pda, borrower, borrower_usdc, borrower_collateral, borrow_pos, collateral_vault, usdc_mint, prediction_mint)
}

// === New Tests ===

#[test]
fn test_oracle_update_and_resolve() {
    let (mut svm, admin) = setup();
    let prediction_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let (oracle_pda, _) = find_oracle_pda(&prediction_mint);

    // Init oracle at 75%
    let ix = init_oracle_ix(&admin.pubkey(), &prediction_mint, &oracle_pda, 7500);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    // Verify initial state
    let oracle_account = svm.get_account(&oracle_pda).unwrap();
    let oracle = ProbabilityOracle::try_deserialize(&mut oracle_account.data.as_slice()).unwrap();
    assert_eq!(oracle.probability_bps, 7500);
    assert!(!oracle.resolved);

    // Update to 40%
    let ix = update_oracle_ix(&admin.pubkey(), &oracle_pda, 4000);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    let oracle_account = svm.get_account(&oracle_pda).unwrap();
    let oracle = ProbabilityOracle::try_deserialize(&mut oracle_account.data.as_slice()).unwrap();
    assert_eq!(oracle.probability_bps, 4000);

    // Resolve as YES
    let ix = resolve_oracle_ix(&admin.pubkey(), &oracle_pda, true);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    let oracle_account = svm.get_account(&oracle_pda).unwrap();
    let oracle = ProbabilityOracle::try_deserialize(&mut oracle_account.data.as_slice()).unwrap();
    assert!(oracle.resolved);
    assert!(oracle.outcome);
    assert_eq!(oracle.probability_bps, 10000);

    // Cannot update after resolution
    let ix = update_oracle_ix(&admin.pubkey(), &oracle_pda, 5000);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    let result = svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash()));
    assert!(result.is_err(), "Should not update resolved oracle");
}

#[test]
fn test_liquidation_after_probability_drop() {
    let (mut svm, admin) = setup();
    let (pool_pda, vault_pda, oracle_pda, borrower, _borrower_usdc, _borrower_collateral, borrow_pos, collateral_vault, usdc_mint, prediction_mint) =
        setup_borrow_scenario(&mut svm, &admin, 7500);

    // Position: 1000 collateral at 75%, borrowed 300 USDC
    // At 75%: collateral_value = 750, health = 750 * 6500 / (300 * 10000^2) = ok
    // Drop probability to 30%: collateral_value = 300
    // health = 300 * 6500 < 300 * 10000^2? => 1_950_000 < 30_000_000_000 => liquidatable

    let ix = update_oracle_ix(&admin.pubkey(), &oracle_pda, 3000);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    // Setup liquidator
    let liquidator = Keypair::new();
    svm.airdrop(&liquidator.pubkey(), 10_000_000_000).unwrap();
    let liquidator_usdc = create_token_account(&mut svm, &liquidator, &usdc_mint, &liquidator.pubkey());
    let liquidator_collateral = create_token_account(&mut svm, &liquidator, &prediction_mint, &liquidator.pubkey());
    mint_to(&mut svm, &admin, &usdc_mint, &liquidator_usdc, 1_000_000_000);

    // Liquidate
    let ix = liquidate_ix(
        &liquidator.pubkey(), &borrower.pubkey(), &pool_pda,
        &prediction_mint, &oracle_pda, &usdc_mint,
        &borrow_pos, &collateral_vault,
        &liquidator_usdc, &liquidator_collateral, &vault_pda,
    );
    let msg = Message::new(&[ix], Some(&liquidator.pubkey()));
    svm.send_transaction(Transaction::new(&[&liquidator], msg, svm.latest_blockhash())).unwrap();

    // Verify position is zeroed
    let pos_account = svm.get_account(&borrow_pos).unwrap();
    let pos = BorrowPosition::try_deserialize(&mut pos_account.data.as_slice()).unwrap();
    assert_eq!(pos.borrowed_amount, 0);
    assert_eq!(pos.collateral_amount, 0);

    // Pool borrowed should be 0
    let pool_account = svm.get_account(&pool_pda).unwrap();
    let pool = LendingPool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.total_borrowed, 0);
}

#[test]
fn test_liquidation_fails_when_healthy() {
    let (mut svm, admin) = setup();
    let (pool_pda, vault_pda, oracle_pda, borrower, _borrower_usdc, _borrower_collateral, borrow_pos, collateral_vault, usdc_mint, prediction_mint) =
        setup_borrow_scenario(&mut svm, &admin, 7500);

    // Position is healthy at 75% — liquidation should fail
    let liquidator = Keypair::new();
    svm.airdrop(&liquidator.pubkey(), 10_000_000_000).unwrap();
    let liquidator_usdc = create_token_account(&mut svm, &liquidator, &usdc_mint, &liquidator.pubkey());
    let liquidator_collateral = create_token_account(&mut svm, &liquidator, &prediction_mint, &liquidator.pubkey());
    mint_to(&mut svm, &admin, &usdc_mint, &liquidator_usdc, 1_000_000_000);

    let ix = liquidate_ix(
        &liquidator.pubkey(), &borrower.pubkey(), &pool_pda,
        &prediction_mint, &oracle_pda, &usdc_mint,
        &borrow_pos, &collateral_vault,
        &liquidator_usdc, &liquidator_collateral, &vault_pda,
    );
    let msg = Message::new(&[ix], Some(&liquidator.pubkey()));
    let result = svm.send_transaction(Transaction::new(&[&liquidator], msg, svm.latest_blockhash()));
    assert!(result.is_err(), "Should not liquidate healthy position");
}

#[test]
fn test_withdraw_exceeds_available_fails() {
    let (mut svm, admin) = setup();
    let usdc_mint = create_mint(&mut svm, &admin, USDC_DECIMALS);
    let (pool_pda, _) = find_pool_pda(&usdc_mint);
    let (vault_pda, _) = find_vault_pda(&pool_pda);

    // Init pool and deposit 500
    let ix = init_pool_ix(&admin.pubkey(), &usdc_mint, &pool_pda, &vault_pda);
    let msg = Message::new(&[ix], Some(&admin.pubkey()));
    svm.send_transaction(Transaction::new(&[&admin], msg, svm.latest_blockhash())).unwrap();

    let lender = Keypair::new();
    svm.airdrop(&lender.pubkey(), 10_000_000_000).unwrap();
    let lender_usdc = create_token_account(&mut svm, &lender, &usdc_mint, &lender.pubkey());
    mint_to(&mut svm, &admin, &usdc_mint, &lender_usdc, 500_000_000);
    let (lender_pos, _) = find_lender_pda(&pool_pda, &lender.pubkey());

    let ix = deposit_ix(&lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda, 500_000_000);
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash())).unwrap();

    // Try to withdraw 600 (more than deposited)
    let ix = withdraw_ix(&lender.pubkey(), &pool_pda, &lender_pos, &usdc_mint, &lender_usdc, &vault_pda, 600_000_000);
    let msg = Message::new(&[ix], Some(&lender.pubkey()));
    let result = svm.send_transaction(Transaction::new(&[&lender], msg, svm.latest_blockhash()));
    assert!(result.is_err(), "Should not withdraw more than deposited");
}

#[test]
fn test_partial_repay() {
    let (mut svm, admin) = setup();
    let (pool_pda, vault_pda, _oracle_pda, borrower, borrower_usdc, borrower_collateral, borrow_pos, collateral_vault, usdc_mint, prediction_mint) =
        setup_borrow_scenario(&mut svm, &admin, 7500);

    // Partial repay: 100 out of 300
    mint_to(&mut svm, &admin, &usdc_mint, &borrower_usdc, 100_000_000);
    let ix = repay_ix(
        &borrower.pubkey(), &pool_pda, &prediction_mint, &usdc_mint,
        &borrow_pos, &collateral_vault, &borrower_collateral,
        &borrower_usdc, &vault_pda,
        100_000_000,
    );
    let msg = Message::new(&[ix], Some(&borrower.pubkey()));
    svm.send_transaction(Transaction::new(&[&borrower], msg, svm.latest_blockhash())).unwrap();

    // Should still have 200 borrowed, collateral still locked
    let pos_account = svm.get_account(&borrow_pos).unwrap();
    let pos = BorrowPosition::try_deserialize(&mut pos_account.data.as_slice()).unwrap();
    assert_eq!(pos.borrowed_amount, 200_000_000);
    assert_eq!(pos.collateral_amount, 1_000_000_000); // collateral stays

    let pool_account = svm.get_account(&pool_pda).unwrap();
    let pool = LendingPool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.total_borrowed, 200_000_000);
}
