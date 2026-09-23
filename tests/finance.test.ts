import assert from "node:assert/strict";
import { test } from "node:test";
import { cents, formatMoney, MAX_CENTS, moneyInput, parseMoney } from "../src/features/app/finance/money.ts";
import { customSplit, equalSplit } from "../src/features/app/finance/splits.ts";
import { entityBalances, obligationAmounts } from "../src/features/app/finance/balances.ts";
import { canManage, canRecord, financeAccess, ownEntity } from "../src/features/app/finance/access.ts";
import { emptyFinance, financeError } from "../src/features/app/finance/data.ts";
import { makeFinanceDraft, validateFinance } from "../src/features/app/finance/validation.ts";
import { getAvailableTabs } from "../src/components/admin/navigation.ts";
import type { AppAccess, Member } from "../src/features/app/types.ts";
import type { FinanceTransaction, Obligation, Payment } from "../src/features/app/finance/types.ts";

const member:Member={id:"m1",user_id:"u1",first_name:"Alex",last_name:"Test",active:true,created_at:"",updated_at:""};
const access:AppAccess={member,roles:[],permissions:["app.access","finance.access"]};
const tx:FinanceTransaction={id:"t1",kind:"DIRECT_DEBT",title:"Dette",description:null,amount_cents:"8000",currency:"EUR",paid_by_entity_id:null,debtor_entity_id:"e1",creditor_entity_id:"e2",split_mode:null,expense_date:"2026-09-23",visibility:"PRIVATE",status:"ACTIVE",revision:1,created_by:"u1",updated_by:"u1",created_at:"",updated_at:""};
const obligation:Obligation={id:"o1",transaction_id:"t1",debtor_entity_id:"e1",creditor_entity_id:"e2",original_amount_cents:"8000"};
const payment:Payment={id:"p1",transaction_id:"t1",from_entity_id:"e1",to_entity_id:"e2",amount_cents:"3000",payment_date:"2026-09-24",comment:null,status:"ACTIVE",created_by:"u1",created_at:"",cancelled_at:null,cancelled_by:null,cancellation_reason:null};

test("Money: exact cents parsing, addition, formatting and safe DB JSON normalization",()=>{
  assert.equal(parseMoney("0,10")+parseMoney("0,20"),30n);
  assert.equal(parseMoney("1 240,50"),124050n);
  assert.equal(parseMoney("147.82"),14782n);
  assert.equal(parseMoney("0",true),0n);
  assert.equal(cents(14782),14782n);
  assert.equal(moneyInput(14782n),"147,82");
  assert.equal(formatMoney(-124050n),"-1\u202f240,50\u00a0€");
  assert.equal(parseMoney(moneyInput(MAX_CENTS)),MAX_CENTS);
  for(const bad of ["", "0", "-1", "0,001", "NaN", "Infinity", "1e3", "1.234,50", "10000000000"]) assert.throws(()=>parseMoney(bad));
  assert.throws(()=>cents(0.1)); assert.throws(()=>cents(Number.MAX_SAFE_INTEGER+1));
  assert.throws(()=>cents("1.5"));
});

test("Equal split: deterministic remainder independent of participant input order, including one cent for two",()=>{
  assert.deepEqual(equalSplit(14782n,["d","a","c","b"]).map(s=>s.amount_cents),[3696n,3696n,3695n,3695n]);
  assert.deepEqual(equalSplit(1000n,["c","a","b"]),equalSplit(1000n,["a","b","c"]));
  assert.deepEqual(equalSplit(1n,["a","b"]).map(s=>s.amount_cents),[1n,0n]);
  for(const total of [1n,2n,10n,1000n,10000n,14782n,MAX_CENTS]) for(let count=1;count<=40;count++) {
    const shares=equalSplit(total,Array.from({length:count},(_,i)=>String(i).padStart(3,"0")));
    assert.equal(shares.reduce((sum,s)=>sum+s.amount_cents,0n),total);
    assert.ok(shares.every(s=>s.amount_cents>=0n));
    assert.ok(shares[0].amount_cents-shares.at(-1)!.amount_cents<=1n);
  }
  assert.throws(()=>equalSplit(0n,["a"])); assert.throws(()=>equalSplit(100n,[])); assert.throws(()=>equalSplit(100n,["a","a"]));
});

test("Custom split: exact equality, zero shares allowed, invalid total/negative/duplicate rejected",()=>{
  const shares=[{entity_id:"a",amount_cents:0n},{entity_id:"b",amount_cents:100n}];
  assert.equal(customSplit(100n,shares),shares);
  for(const total of [99n,101n,0n,-1n]) assert.throws(()=>customSplit(total,shares));
  assert.throws(()=>customSplit(100n,[{entity_id:"a",amount_cents:-1n},{entity_id:"b",amount_cents:101n}]));
  assert.throws(()=>customSplit(100n,[{entity_id:"a",amount_cents:50n},{entity_id:"a",amount_cents:50n}]));
});

test("Balances preserve both directions and Chiro debts without netting payable/receivable",()=>{
  const rows={...emptyFinance,transactions:[tx,{...tx,id:"t2"},{...tx,id:"t3"},{...tx,id:"t4"}],obligations:[obligation,
    {...obligation,id:"o2",transaction_id:"t2",debtor_entity_id:"e2",creditor_entity_id:"e1",original_amount_cents:"4250"},
    {...obligation,id:"o3",transaction_id:"t3",debtor_entity_id:"e1",creditor_entity_id:"chiro",original_amount_cents:"1000"},
    {...obligation,id:"o4",transaction_id:"t4",debtor_entity_id:"chiro",creditor_entity_id:"e1",original_amount_cents:"500"}],payments:[payment],allocations:[{payment_id:"p1",obligation_id:"o1",amount_cents:"3000"}]};
  const totals=entityBalances("e1",rows);
  assert.equal(totals.payable,6000n); assert.equal(totals.receivable,4750n); assert.equal(totals.net,-1250n);
  assert.deepEqual(totals.counterparties.get("e2"),{payable:5000n,receivable:4250n});
  assert.equal(entityBalances("chiro",rows).receivable,1000n);
  assert.equal(entityBalances("chiro",rows).payable,500n);
  assert.equal(entityBalances(undefined,rows).payable,0n);
});

test("Repayments preserve original amount, settle exactly, restore on payment cancellation and exclude cancelled debt",()=>{
  const rows={...emptyFinance,transactions:[tx],obligations:[obligation],payments:[payment,{...payment,id:"p2",amount_cents:"1000"}],allocations:[{payment_id:"p1",obligation_id:"o1",amount_cents:"3000"},{payment_id:"p2",obligation_id:"o1",amount_cents:"1000"}]};
  assert.deepEqual(obligationAmounts(obligation,rows),{original:8000n,paid:4000n,remaining:4000n,cancelled:false});
  rows.payments[1].status="CANCELLED"; assert.equal(obligationAmounts(obligation,rows).remaining,5000n);
  rows.allocations[0].amount_cents="8000"; assert.equal(obligationAmounts(obligation,rows).remaining,0n);
  rows.allocations[0].amount_cents="8001"; assert.throws(()=>obligationAmounts(obligation,rows),/incohérentes/);
  rows.allocations[0].amount_cents="3000";
  assert.equal(obligationAmounts(obligation,{...rows,transactions:[{...tx,status:"CANCELLED"}]}).remaining,0n);
  assert.equal(tx.amount_cents,"8000"); assert.equal(obligation.original_amount_cents,"8000");
});

test("Finance UI authorization: treasury permission is explicit, SITE and technical admin grant no financial bypass",()=>{
  assert.equal(financeAccess(access),true);
  assert.equal(canManage(tx,access,"u1"),true); assert.equal(canManage(tx,access,"admin"),false);
  assert.equal(canRecord(tx,obligation,access,"e1"),true); assert.equal(canRecord(tx,obligation,access,"outsider"),false);
  const treasury={...tx,visibility:"TREASURY" as const};
  assert.equal(canRecord(treasury,obligation,access,"e1"),false);
  const treasurer:AppAccess={...access,permissions:[...access.permissions,"finance.treasury.manage"]};
  assert.equal(canRecord(treasury,obligation,treasurer),true);
  assert.equal(canRecord(tx,obligation,treasurer,"outsider"),false);
  assert.equal(financeAccess({...access,permissions:["finance.access"]}),false);
  assert.equal(ownEntity([{id:"e1",type:"MEMBER",member_id:"m1"}],access),"e1");
  const profile={user_id:"u1",email:"test@example.test",full_name:"Test",role:"none" as const,managedGroupSlugs:[],created_at:""};
  assert.ok(getAvailableTabs(profile,access.permissions).some(t=>t.id==="app-finance"));
  assert.ok(!getAvailableTabs({...profile,role:"admin"},[]).some(t=>t.id==="app-finance"));
});

test("Finance validation: self debt, archived member, exact shares and treasury involvement",()=>{
  const data={...emptyFinance,entities:[{id:"e1",type:"MEMBER" as const,member_id:"m1"},{id:"e2",type:"MEMBER" as const,member_id:"m2"},{id:"chiro",type:"CHIRO" as const,member_id:null}],members:[member,{...member,id:"m2",user_id:null,active:false}]};
  const draft={...makeFinanceDraft("DIRECT_DEBT","e1"),title:"Dette",amount:"80",creditor:"e1"};
  assert.throws(()=>validateFinance(draft,data),/elle-même/);
  assert.throws(()=>validateFinance({...draft,creditor:"e2"},data),/actifs/);
  assert.equal(validateFinance({...draft,creditor:"e2"},data,tx).details.amount_cents,"8000");
  assert.throws(()=>validateFinance({...draft,creditor:"chiro"},data),/trésorerie/);
  assert.equal(validateFinance({...draft,creditor:"chiro",visibility:"TREASURY"},data).details.amount_cents,"8000");
  assert.throws(()=>validateFinance({...draft,date:"2026-02-30"},data));
  assert.throws(()=>validateFinance({...draft,title:" "},data));
  assert.equal(financeError({code:"22003",details:"2000"}),"Le montant dépasse le solde restant de 20,00\u00a0€.");
});
