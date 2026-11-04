// Screen registry, in the order the design canvas lays them out.
import type { ScreenClass } from '../lib/screen.js';
import MainScreen from './Main.js';
import SupplierLandingScreen from './Supplier-Landing.js';
import HelpScreen from './Help.js';
import HelpInquiryScreen from './Help-Inquiry.js';
import LoginScreen from './Login.js';
import ResetScreen from './Reset.js';
import SignupScreen from './Signup.js';
import SignupRoleScreen from './Signup-Role.js';
import SignupClientScreen from './Signup-Client.js';
import SignupSupplierScreen from './Signup-Supplier.js';
import TermsScreen from './Terms.js';
import HomeClientScreen from './Home-Client.js';
import ProfileClientScreen from './Profile-Client.js';
import AccountClientScreen from './Account-Client.js';
import InputClientScreen from './Input-Client.js';
import DraftClientScreen from './Draft-Client.js';
import ReportClientScreen from './Report-Client.js';
import ConfirmClientScreen from './Confirm-Client.js';
import MyClientScreen from './My-Client.js';
import SpecClientScreen from './Spec-Client.js';
import CompareClientScreen from './Compare-Client.js';
import QuoteClientScreen from './Quote-Client.js';
import PublicsupplierScreen from './PublicSupplier.js';
import ChatClientScreen from './Chat-Client.js';
import AgreementClientScreen from './Agreement-Client.js';
import ContractClientScreen from './Contract-Client.js';
import EscrowClientScreen from './Escrow-Client.js';
import ContractsClientScreen from './Contracts-Client.js';
import CancelClientScreen from './Cancel-Client.js';
import InspectClientScreen from './Inspect-Client.js';
import SettleClientScreen from './Settle-Client.js';
import ReviewClientScreen from './Review-Client.js';
import NotifyClientScreen from './Notify-Client.js';
import HomeSupplierScreen from './Home-Supplier.js';
import ProfileSupplierScreen from './Profile-Supplier.js';
import AccountSupplierScreen from './Account-Supplier.js';
import FindSupplierScreen from './Find-Supplier.js';
import ProjectSupplierScreen from './Project-Supplier.js';
import PublicclientScreen from './PublicClient.js';
import QuotewriteSupplierScreen from './QuoteWrite-Supplier.js';
import AppsSupplierScreen from './Apps-Supplier.js';
import QuoteviewSupplierScreen from './QuoteView-Supplier.js';
import ChatSupplierScreen from './Chat-Supplier.js';
import ContractSupplierScreen from './Contract-Supplier.js';
import ContractsSupplierScreen from './Contracts-Supplier.js';
import CancelSupplierScreen from './Cancel-Supplier.js';
import DeliverSupplierScreen from './Deliver-Supplier.js';
import SettleSupplierScreen from './Settle-Supplier.js';
import ReviewSupplierScreen from './Review-Supplier.js';
import NotifySupplierScreen from './Notify-Supplier.js';
import AdminBlocksScreen from './Admin-Blocks.js';
import AdminPaymentsScreen from './Admin-Payments.js';
import AdminRefundsScreen from './Admin-Refunds.js';
import AdminDisputesScreen from './Admin-Disputes.js';
import AdminEventsScreen from './Admin-Events.js';
import AdminReportsScreen from './Admin-Reports.js';
import AdminInquiriesScreen from './Admin-Inquiries.js';

export const screens: readonly ScreenClass[] = [
  MainScreen,
  SupplierLandingScreen,
  HelpScreen,
  HelpInquiryScreen,
  LoginScreen,
  ResetScreen,
  SignupScreen,
  SignupRoleScreen,
  SignupClientScreen,
  SignupSupplierScreen,
  TermsScreen,
  HomeClientScreen,
  ProfileClientScreen,
  AccountClientScreen,
  InputClientScreen,
  DraftClientScreen,
  ReportClientScreen,
  ConfirmClientScreen,
  MyClientScreen,
  SpecClientScreen,
  CompareClientScreen,
  QuoteClientScreen,
  PublicsupplierScreen,
  ChatClientScreen,
  AgreementClientScreen,
  ContractClientScreen,
  EscrowClientScreen,
  ContractsClientScreen,
  CancelClientScreen,
  InspectClientScreen,
  SettleClientScreen,
  ReviewClientScreen,
  NotifyClientScreen,
  HomeSupplierScreen,
  ProfileSupplierScreen,
  AccountSupplierScreen,
  FindSupplierScreen,
  ProjectSupplierScreen,
  PublicclientScreen,
  QuotewriteSupplierScreen,
  AppsSupplierScreen,
  QuoteviewSupplierScreen,
  ChatSupplierScreen,
  ContractSupplierScreen,
  ContractsSupplierScreen,
  CancelSupplierScreen,
  DeliverSupplierScreen,
  SettleSupplierScreen,
  ReviewSupplierScreen,
  NotifySupplierScreen,
  AdminBlocksScreen,
  AdminPaymentsScreen,
  AdminRefundsScreen,
  AdminDisputesScreen,
  AdminEventsScreen,
  AdminReportsScreen,
  AdminInquiriesScreen,
];
