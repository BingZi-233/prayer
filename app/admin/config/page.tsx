"use client"

import {
  Save,
  Cable,
  Send,
  MessageSquareText,
  Bot,
  MessagesSquare,
  Brain,
  Zap,
  Bell,
  HardDrive,
  Shield,
} from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PageShell } from "@/components/admin/page-shell"
import { PageHeader } from "@/components/admin/page-header"
import { ErrorState } from "@/components/admin/data-state"

import { useConfigForm } from "@/components/admin/config/use-config-form"
import { QqSettings } from "@/components/admin/config/qq-settings"
import { TgSettings } from "@/components/admin/config/tg-settings"
import { AdminSettings } from "@/components/admin/config/admin-settings"
import { ReplySettings } from "@/components/admin/config/reply-settings"
import { SdkSettings } from "@/components/admin/config/sdk-settings"
import { SessionSettings } from "@/components/admin/config/session-settings"
import { ReflectSettings } from "@/components/admin/config/reflect-settings"
import { ProactiveSettings } from "@/components/admin/config/proactive-settings"
import { NotifySettings } from "@/components/admin/config/notify-settings"
import { StorageSettings } from "@/components/admin/config/storage-settings"

export default function ConfigPage() {
  const {
    cfg,
    setCfg,
    updateField,
    fieldValue,
    groups,
    groupsLoading,
    admins,
    adminsLoading,
    enabledQqIds,
    enabledTgIds,
    adminQq,
    toggleGroup,
    adminLabel,
    toggleExtraAt,
    groupName,
    tgChatDraft,
    setTgChatDraft,
    addTgChat,
    removeTgChat,
    tgTokenConfigured,
    tgBypassWarn,
    tgChannel,
    tgChatTitle,
    setAdminChannel,
    setAdminChatId,
    adminGroupOptions,
    adminTgOptions,
    busy,
    save,
    error,
    reload,
  } = useConfigForm()

  return (
    <PageShell>
      <PageHeader
        title="配置"
        description="修改后保存即生效。通道连接与业务参数分栏。"
        actions={
          <Button onClick={save} disabled={busy || !cfg}>
            {busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Save data-icon="inline-start" />
            )}
            {busy ? "保存中…" : "保存并生效"}
          </Button>
        }
      />

      {error && <ErrorState description={error} onRetry={reload} />}
      {!cfg && !error && <Skeleton className="h-72 w-full" />}

      {cfg && (
        <Tabs defaultValue="qq">
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="qq">
              <Cable data-icon="inline-start" /> QQ 通道
            </TabsTrigger>
            <TabsTrigger value="tg">
              <Send data-icon="inline-start" /> TG 通道
            </TabsTrigger>
            <TabsTrigger value="admin">
              <Shield data-icon="inline-start" /> 管理面
            </TabsTrigger>
            <TabsTrigger value="reply">
              <MessageSquareText data-icon="inline-start" /> 回复体验
            </TabsTrigger>
            <TabsTrigger value="session">
              <MessagesSquare data-icon="inline-start" /> 会话
            </TabsTrigger>
            <TabsTrigger value="reflect">
              <Brain data-icon="inline-start" /> 反思
            </TabsTrigger>
            <TabsTrigger value="proactive">
              <Zap data-icon="inline-start" /> 主动回复
            </TabsTrigger>
            <TabsTrigger value="notify">
              <Bell data-icon="inline-start" /> 通知
            </TabsTrigger>
            <TabsTrigger value="sdk">
              <Bot data-icon="inline-start" /> Claude SDK
            </TabsTrigger>
            <TabsTrigger value="storage">
              <HardDrive data-icon="inline-start" /> 存储
            </TabsTrigger>
          </TabsList>

          <QqSettings
            cfg={cfg}
            updateField={updateField}
            fieldValue={fieldValue}
            groups={groups}
            groupsLoading={groupsLoading}
            admins={admins}
            adminsLoading={adminsLoading}
            enabledQqIds={enabledQqIds}
            adminQq={adminQq}
            toggleGroup={toggleGroup}
            adminLabel={adminLabel}
            toggleExtraAt={toggleExtraAt}
            groupName={groupName}
          />

          <TgSettings
            cfg={cfg}
            setCfg={setCfg}
            enabledTgIds={enabledTgIds}
            tgChatDraft={tgChatDraft}
            setTgChatDraft={setTgChatDraft}
            addTgChat={addTgChat}
            removeTgChat={removeTgChat}
            tgTokenConfigured={tgTokenConfigured}
            tgBypassWarn={tgBypassWarn}
            tgChannel={tgChannel}
            tgChatTitle={tgChatTitle}
          />

          <AdminSettings
            cfg={cfg}
            updateField={updateField}
            fieldValue={fieldValue}
            groups={groups}
            groupsLoading={groupsLoading}
            adminQq={adminQq}
            setAdminChannel={setAdminChannel}
            setAdminChatId={setAdminChatId}
            adminGroupOptions={adminGroupOptions}
            adminTgOptions={adminTgOptions}
          />

          <ReplySettings
            cfg={cfg}
            setCfg={setCfg}
            updateField={updateField}
            fieldValue={fieldValue}
          />

          <SdkSettings cfg={cfg} updateField={updateField} />

          <SessionSettings
            cfg={cfg}
            setCfg={setCfg}
            updateField={updateField}
            fieldValue={fieldValue}
          />

          <ReflectSettings
            cfg={cfg}
            setCfg={setCfg}
            updateField={updateField}
            fieldValue={fieldValue}
          />

          <ProactiveSettings
            cfg={cfg}
            setCfg={setCfg}
            updateField={updateField}
            fieldValue={fieldValue}
          />

          <NotifySettings cfg={cfg} setCfg={setCfg} />

          <StorageSettings cfg={cfg} updateField={updateField} />
        </Tabs>
      )}
    </PageShell>
  )
}
